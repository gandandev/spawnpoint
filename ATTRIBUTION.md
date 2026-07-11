# third-party runtime inventory

spawnpoint is an integration layer. it does not claim ownership of Minecraft, Eaglercraft, Paper, or the bundled community client builds.

| component | role | source | sha-256 |
| --- | --- | --- | --- |
| Eaglercraft 1.12.2 WASM-GC | default browser client, patched so the 1.12 data fixer and Korean locale metadata use the same id | [Nexus Launcher for Eaglercraft 1.12](https://github.com/NexProPlayzDev/Nexus-Launcher-for-Eaglercraft1.12) | `6c4e3a34bb72307898f2eeea407a4da84f3ff1161503bf4f1517a6fb9ed290f0` |
| Minecraft 1.12 Korean locale | Korean browser-client UI strings | [Mojang 1.12 asset object](https://resources.download.minecraft.net/50/502813d62264297168b2fb6cf732fc3ee337d42f) | `b9acfcb2f87d6dc488adc415a58c5543eac180744d64271b913ab3ad42593fee` |
| Paper 1.12.2 | Minecraft server | [Eaglercraft Paper 1.12 template](https://github.com/WoolseyWorkshop/eaglercraft-paper-server) | `3a2041807f492dcdc34ebb324a287414946e3e05ec3df6fd03f5b5f7d9afc210` |
| Paper API 1.12.2 shaded | custom plugin compile classpath only | [PaperMC Maven repository](https://repo.papermc.io/) | `45416ecb816c2a32fb5562a687d7e1ab5cd8d3fe59d3db78d2f377dc7ff15a37` |
| EaglerXServer 1.1.0 | Eaglercraft WebSocket server bridge | [official EaglerXServer](https://github.com/lax1dude/eaglerxserver) | `130fc3bc07eb0bff0a99676669da4035df9b03fdce57ee34ee1aeba8fa7e25d0` |


Minecraft is a trademark of Microsoft/Mojang. this project is not affiliated with or endorsed by them. before enabling the server, read and accept the [Minecraft EULA](https://www.minecraft.net/eula) yourself.
