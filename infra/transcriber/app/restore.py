"""Restore a model already present in the models volume after a restart.

The one ``.selected`` file records the last model that actually reached
``ready`` so a restart loads the owner's choice. A value that is no longer
allowlisted (such as a legacy Whisper id) is ignored.

Startup also removes the faster-whisper caches that earlier releases left in the
volume; see :func:`remove_legacy_whisper_cache`.
"""

from __future__ import annotations

import fnmatch
import logging
import os
import shutil
from typing import Any, Callable

from .models import ALLOWED_MODELS, LoadedModel

logger = logging.getLogger("aulora.transcriber")

# Exact Hugging Face cache directory names used by the removed Whisper models:
# Systran/faster-whisper-{tiny,base,small,medium} and
# mobiuslabsgmbh/faster-whisper-large-v3-turbo.
LEGACY_WHISPER_PATTERNS: tuple[str, ...] = (
    "models--Systran--faster-whisper-*",
    "models--mobiuslabsgmbh--faster-whisper-*",
)

SELECTED_FILE = ".selected"
# First cached model wins when there is no explicit selection.
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

    The loader is injected so tests can fake the engine. A missing model
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


def _legacy_cache_roots(models_dir: str) -> list[str]:
    # `WhisperModel(download_root=models_dir)` wrote `<models_dir>/models--*`;
    # the default Hugging Face hub cache (`HF_HOME=<models_dir>/hf-cache`) wrote
    # `<models_dir>/hf-cache/hub/models--*`. `.locks` sits next to each.
    bases = [models_dir, os.path.join(models_dir, "hf-cache", "hub")]
    return [*bases, *(os.path.join(base, ".locks") for base in bases)]


def remove_legacy_whisper_cache(models_dir: str) -> list[str]:
    """Best-effort removal of faster-whisper weights from earlier releases.

    Deletes only real directories whose name matches ``LEGACY_WHISPER_PATTERNS``
    directly inside the known cache roots. Symlinks and everything else are
    left alone; failures are logged and skipped.
    """
    removed: list[str] = []
    for root in _legacy_cache_roots(models_dir):
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for name in names:
            if not any(fnmatch.fnmatchcase(name, pattern) for pattern in LEGACY_WHISPER_PATTERNS):
                continue
            path = os.path.join(root, name)
            try:
                if os.path.islink(path) or not os.path.isdir(path):
                    continue
                shutil.rmtree(path)
                removed.append(path)
            except OSError:
                logger.warning("could not remove legacy model cache %s", path)
    if removed:
        logger.info("removed %d legacy faster-whisper cache directories", len(removed))
    return removed
