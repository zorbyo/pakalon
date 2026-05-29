"""Python startup tweaks for local development.

This module is imported automatically by Python during startup when it is
present on the import path. We use it to force the Windows selector event loop
policy early enough for psycopg's async driver, including when the app is
started via the `uvicorn` CLI.
"""

import asyncio
import asyncio.runners
import multiprocessing.util
import os
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    _is_uvicorn_process = any("uvicorn" in arg.lower() for arg in sys.argv)
    _is_uvicorn_reload_worker = _is_uvicorn_process or os.environ.get("UVICORN_RELOAD") == "true"

    _original_runner_close = asyncio.runners.Runner.close

    def _runner_close_safely(self) -> None:
        """Work around Python 3.13 Windows reload teardown race.

        During uvicorn --reload shutdown, Runner.close() can raise
        `RuntimeError("Cannot close a running event loop")` after cancellation.
        This is a shutdown-only edge case; we best-effort stop/close and continue.
        """

        try:
            _original_runner_close(self)
        except KeyboardInterrupt:
            if not _is_uvicorn_reload_worker:
                raise
            loop = getattr(self, "_loop", None)
            if loop is not None:
                try:
                    if loop.is_running():
                        loop.stop()
                except Exception:
                    pass
                try:
                    if not loop.is_closed():
                        loop.close()
                except Exception:
                    pass
            self._loop = None
        except RuntimeError as exc:
            if "Cannot close a running event loop" not in str(exc):
                raise
            if not _is_uvicorn_reload_worker:
                raise

            loop = getattr(self, "_loop", None)
            if loop is not None:
                try:
                    if loop.is_running():
                        loop.stop()
                except Exception:
                    pass
                try:
                    if not loop.is_closed():
                        loop.close()
                except Exception:
                    pass
            self._loop = None

    asyncio.runners.Runner.close = _runner_close_safely

    _original_excepthook = sys.excepthook

    def _quiet_uvicorn_reload_excepthook(exc_type, exc_value, exc_traceback):
        """Suppress noisy, shutdown-only reload worker exceptions on Windows."""

        if _is_uvicorn_reload_worker:
            if exc_type is KeyboardInterrupt:
                return
            if exc_type is RuntimeError and "Cannot close a running event loop" in str(exc_value):
                return

        _original_excepthook(exc_type, exc_value, exc_traceback)

    sys.excepthook = _quiet_uvicorn_reload_excepthook

    _original_flush_std_streams = multiprocessing.util._flush_std_streams

    def _flush_std_streams_safely() -> None:
        """Avoid noisy traceback during Ctrl+C shutdown with spawned reloader workers.

        On Windows + Python 3.13, uvicorn --reload can emit a traceback from
        multiprocessing's final stdio flush when a KeyboardInterrupt lands during
        process teardown. Treat this as graceful shutdown noise.
        """

        try:
            _original_flush_std_streams()
        except KeyboardInterrupt:
            return

    multiprocessing.util._flush_std_streams = _flush_std_streams_safely
