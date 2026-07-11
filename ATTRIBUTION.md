# third-party runtime inventory

spawnpoint is an integration layer. it does not claim ownership of Minecraft, Eaglercraft, Paper, or the bundled community client builds.

| component | role | source | sha-256 |
| --- | --- | --- | --- |
| Eaglercraft 1.12.2 WASM-GC | default browser client | [Nexus Launcher for Eaglercraft 1.12](https://github.com/NexProPlayzDev/Nexus-Launcher-for-Eaglercraft1.12) | `92e1e66f804dffceafbbf88828e8e8eb4ad9c087f42792c81daa7fb6f9e5ca8f` |
| Eaglercraft 1.21.11 WASM-GC U1 beta | experimental modern browser client | community offline release, upstream source was not published with the binary | `b43ebfff4af0951e6cc1f4268d132d8d9d31710bbb13406605776e40308fc0d2` |
| EaglercraftX 1.8 u53 signed | low-end fallback client | [EaglercraftX 1.8](https://github.com/Eaglercraft-Archive/Eaglercraftx-1.8.8-src) | `e59ab8c477d7aad12cc4d1f148a2728e2278d384e9c91d2ba6aa4eed432fc171` |
| Paper 1.12.2 | Minecraft server | [Eaglercraft Paper 1.12 template](https://github.com/WoolseyWorkshop/eaglercraft-paper-server) | `3a2041807f492dcdc34ebb324a287414946e3e05ec3df6fd03f5b5f7d9afc210` |
| Paper API 1.12.2 shaded | custom plugin compile classpath only | [PaperMC Maven repository](https://repo.papermc.io/) | `45416ecb816c2a32fb5562a687d7e1ab5cd8d3fe59d3db78d2f377dc7ff15a37` |
| EaglerXServer 1.0.7 | Eaglercraft WebSocket server bridge | [official EaglerXServer](https://github.com/lax1dude/eaglerxserver) | `6459a00a9e6b8dd5a58d183befce7b58df763a6f99c38f7086170b33c1d2707b` |

the 1.21.11 client is deliberately labeled beta in the product. it is large, slower on old hardware, and not suitable as the default while its source and stability remain behind the 1.12.2 build.

Minecraft is a trademark of Microsoft/Mojang. this project is not affiliated with or endorsed by them. before enabling the server, read and accept the [Minecraft EULA](https://www.minecraft.net/eula) yourself.
