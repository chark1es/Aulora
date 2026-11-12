"""Allowlisted Whisper model ids and the in-memory install state."""

from __future__ import annotations

from dataclasses import dataclass, field

# Only these ids may be downloaded. A URL never reaches the downloader.
ALLOWED_MODELS: tuple[str, ...] = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3-turbo",
)

MAX_MODEL_ID_LENGTH = 40


def is_allowed_model(model_id: str) -> bool:
    return model_id in ALLOWED_MODELS


@dataclass
class ModelState:
    status: str = "not_installed"
    model_id: str | None = None
    # `None` means indeterminate: a download is running but has no percentage.
    progress: int | None = None
    error: str | None = None

    def snapshot(self) -> dict[str, object]:
        return {
            "modelId": self.model_id,
            "status": self.status,
            "progress": self.progress,
            "error": self.error,
        }

    def start(self, model_id: str) -> None:
        self.model_id = model_id
        self.status = "downloading"
        self.progress = None
        self.error = None

    def ready(self, model_id: str) -> None:
        self.model_id = model_id
        self.status = "ready"
        self.progress = 100
        self.error = None

    def fail(self, model_id: str, error: str) -> None:
        self.model_id = model_id
        self.status = "error"
        self.progress = None
        self.error = error[:300]


@dataclass
class LoadedModel:
    """Holds the currently loaded engine; swapped after a successful download."""

    model_id: str | None = None
    engine: object | None = None
    state: ModelState = field(default_factory=ModelState)

    def is_ready(self) -> bool:
        return self.state.status == "ready" and self.engine is not None
