"""Restore a model already present in the Hugging Face cache after a restart.

faster-whisper stores downloaded weights under its own cache layout, not at
``/models/<id>``. A directory check therefore missed every restart. The one
``.selected`` file records the last model that actually reached ``ready`` so a
restart loads the owner's choice, not merely the largest cached one.
"""

from __future__ import annotations

import os
from typing import Any, Callable

from .models import ALLOWED_MODELS, LoadedModel

SELECTED_FILE = ".selected"
# Smallest first when there is no explicit selection: a small host must not OOM
# trying the largest cached model.
RESTORE_ORDER: tuple[str, ...] = ALLOWED_MODELS


def selected_model_path(models_dir: str) -> str:
    return os.path.join(models_dir, SELECTED_FILE)


def read_selected_model(models_dir: str) -> str | None:
    try:
        with open(selected_model_path(models_dir), encoding="utf-8") as handle:
            value = handle.read().strip()
    except OSError:
        return None
    return value if value in ALLOWED_MODELS else None


def write_selected_model(models_dir: str, model_id: str) -> None:
    """Best effort: a read-only or full volume must not take the engine down."""
    try:
        with open(selected_model_path(models_dir), "w", encoding="utf-8") as handle:
            handle.write(model_id)
    except OSError:
        return


def _candidates(models_dir: str) -> tuple[str, ...]:
    selected = read_selected_model(models_dir)
    if selected is None:
        return RESTORE_ORDER
    return (selected, *(model for model in RESTORE_ORDER if model != selected))


def restore_loaded_model(
    loaded: LoadedModel,
    models_dir: str,
    loader: Callable[[str, str], Any],
    order: tuple[str, ...] | None = None,
) -> str | None:
    """Loads the selected (or first cached) allowlisted model.

    The loader is injected so tests can fake faster-whisper. A missing model
    leaves the state at ``not_installed``.
    """
    candidates = order if order is not None else _candidates(models_dir)
    for model_id in candidates:
        try:
            engine = loader(model_id, models_dir)
        except Exception:  # noqa: BLE001 - try the next cached model
            continue
        loaded.engine = engine
        loaded.model_id = model_id
        loaded.state.ready(model_id)
        write_selected_model(models_dir, model_id)
        return model_id
    loaded.engine = None
    loaded.model_id = None
    loaded.state.status = "not_installed"
    loaded.state.progress = None
    loaded.state.error = None
    return None


def record_download_failure(loaded: LoadedModel, failed_model_id: str, error: str) -> None:
    """Keeps a previously loaded model serving and reports the failed download.

    A failed download of B must not downgrade a working A to `error`.
    """
    if loaded.engine is not None and loaded.model_id is not None:
        last_error = f"Could not download or load {failed_model_id}: {error}"
        loaded.state.ready(loaded.model_id)
        loaded.state.error = last_error[:300]
        return
    loaded.state.fail(failed_model_id, error)
