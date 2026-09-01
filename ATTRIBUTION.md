# third-party runtime inventory

spawnpoint is an integration layer. it does not claim ownership of Minecraft, Eaglercraft, Paper, or the bundled community client builds.

| component | role | source | sha-256 |
| --- | --- | --- | --- |
| Eaglercraft 1.12.2 WASM-GC | default browser client, patched so the 1.12 data fixer and Korean locale metadata use the same id | [Nexus Launcher for Eaglercraft 1.12](https://github.com/NexProPlayzDev/Nexus-Launcher-for-Eaglercraft1.12) | `6c4e3a34bb72307898f2eeea407a4da84f3ff1161503bf4f1517a6fb9ed290f0` |
| EaglerMobile | Apache-2.0 reference for translating touch input into legacy Eaglercraft keyboard and mouse events; Spawnpoint's 1.12 controls are a separate implementation | [FlamedDogo99](https://github.com/FlamedDogo99/EaglerMobile) | not bundled |
| Minecraft 1.12 Korean locale | Korean browser-client UI strings | [Mojang 1.12 asset object](https://resources.download.minecraft.net/50/502813d62264297168b2fb6cf732fc3ee337d42f) | `b9acfcb2f87d6dc488adc415a58c5543eac180744d64271b913ab3ad42593fee` |
| Minecraft 1.12.2 Unicode font | exact bitmap glyph pages and widths used by the portal name tag | [Mojang 1.12.2 client](https://piston-data.mojang.com/v1/objects/0f275bc1547d01fa5f56ba34bdc87d981ee12daf/client.jar) | `8ada07da5ee77dad3527bd7278fbd05ee1fc8a597813b216a871a2d7d64cc64f` |
| Galmuri11 2.40.4 | source for the in-game bitmap font, converted to Minecraft 1.12 glyph pages under the SIL Open Font License 1.1 | [quiple](https://quiple.dev/font/galmuri) | `2c709890595668f7bdb6df408420fda957dde0288e95b31a1cc17a2ab98b4b4f` |
| Paper 1.12.2 | Minecraft server | [Eaglercraft Paper 1.12 template](https://github.com/WoolseyWorkshop/eaglercraft-paper-server) | `3a2041807f492dcdc34ebb324a287414946e3e05ec3df6fd03f5b5f7d9afc210` |
| Paper API 1.12.2 shaded | custom plugin compile classpath only | [PaperMC Maven repository](https://repo.papermc.io/) | `45416ecb816c2a32fb5562a687d7e1ab5cd8d3fe59d3db78d2f377dc7ff15a37` |
| EaglerXServer 1.1.1 | Eaglercraft WebSocket server bridge | [official EaglerXServer](https://github.com/lax1dude/eaglerxserver/releases/tag/v1.1.1) | `468cb07eb7ca466b21b439be75156d3d01579327f4c6dae5b67d471137a64208` |


Minecraft is a trademark of Microsoft/Mojang. this project is not affiliated with or endorsed by them. before enabling the server, read and accept the [Minecraft EULA](https://www.minecraft.net/eula) yourself.
