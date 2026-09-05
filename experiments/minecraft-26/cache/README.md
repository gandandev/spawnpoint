# Optional verified build cache

A deployment upload may place `mojang_26.2.jar` here when the remote builder cannot reach Mojang. `prepare.mjs` verifies its pinned SHA-256 before Paperclip uses it. Do not commit the jar or put player data here. A normal checkout downloads the same pinned artifact.
