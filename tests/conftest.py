import sys

# Workaround for the gltest direct-mode runner on Windows: it calls
# os.unlink() on the stdin message temp file while it is still mapped to
# fd 0, which fails on Windows (the file is still open and cannot be
# deleted). We neutralize that unlink; the file is a small temp file and
# cleanup is best-effort. No-op on POSIX systems.
if sys.platform == "win32":
    try:
        from gltest.direct import loader as _loader
    except ImportError:
        pass
    else:
        _original_inject = _loader._inject_message_to_fd0

        def _patched_inject(vm):
            try:
                _original_inject(vm)
            except PermissionError:
                pass

        _loader._inject_message_to_fd0 = _patched_inject
