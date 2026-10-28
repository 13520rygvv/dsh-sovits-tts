# dsh-sovits-tts

把 [so-vits-svc](https://github.com/innnky/so-vits-svc) 的音色模型接进 **DeepSeek Harness（DSH）**：
每条回答的图标行多一个喇叭按钮，点一下就用你自己的角色音色把这条回答读出来。

> Windows 桌面端插件 + 本地 Python 推理引擎。**本仓库不包含任何模型权重。**

![icon](icon.svg)

## 它做什么

```
回答正文 ──► edge-tts / Windows SAPI 合成中性女声 ──► 16 kHz 单声道
        ──► so-vits-svc 32k 转换音色（HuBERT-Soft 内容特征 + parselmouth f0）
        ──► 32 kHz wav ──► 浏览器 blob 播放（可拖动进度、可同时只播一条）
```

- 喇叭按钮注册在 `conversation.chat.assistant-actions`（order 30，排在复制/点赞/点踩之后）。
- 输入框下方有音色下拉（`conversation.composer.dock`），选好即存。
- 设置里有一整页「语音朗读」（`settings.section`），调音色 / 音调 / 语速 / 音量 / 源语音 / 字数上限 / 高级路径与端口。
- 宿主按需拉起 Python worker（`pythonw.exe`，**不弹黑窗口**），空闲时也能手动重启或关闭。
- **发到 QQ 也能是语音**：见下面「发到 QQ 当语音」。
- **日语口癖读法**：罗马字口癖会先改写成对应的日文，只把这一小段交给日语源语音合成，再和前后中文源音频拼起来一起过音色转换——所以听着是「ですわ」而不是「de su wa」。

  | 文本里写的 | 读成 |
  | --- | --- |
  | `desuwa` / `desu wa` / `DESUWA` | ですわ |
  | `desu no` / `desuno` | ですの |
  | `nanodesu` | なのです |
  | `arimasu wa` / `arimasuwa` | ありますわ |
  | `desu`（单独一个词） | です |

  已经是假名的（`ですわ` 等）原样保留。中文源语音读假名会直接输出空文件，所以这些片段必须换日语源语音；离线 SAPI 兜底时它们改读回罗马字。

## 发到 QQ 当语音

配合 QQ 桥插件（如 `dsh-qq-bridge` + NapCat / OneBot 11）使用时，可以让部分要发到 QQ 的文字变成语音条：

```
QQ 桥 ──POST /send_*_msg──► 本插件的中转（默认 127.0.0.1:3002）
                                  │  掷骰子 / 判长度
                                  │  命中就合成 wav ──► record 段（base64）
                                  ▼
                           NapCat（127.0.0.1:3000）──► QQ
```

- **只做透传 + 改写**：中转对 OneBot 的其它接口原样转发，所以聊天记录轮询、图片、登录信息查询都不受影响。
- 改写只发生在 `send_private_msg` / `send_group_msg` 上；文字段被换成 `record` 段，**图片段原样保留**。
- 两个闸：概率（默认 30%）、单条字数上限（默认 200 字）；超长或没掷中就照旧发文字。
- 中转**常驻**：概率设成 0 也只是不发语音，端口不会消失（否则 QQ 桥会连不上）。
- 用法：把 QQ 桥设置里的「NapCat 地址」改成 `http://127.0.0.1:3002` 即可；改了端口记得同步。
- 判断记录在 `%USERPROFILE%\.dsh\sovits-tts\qq-voice.log`（每条都写明是发了语音还是文字、为什么）。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `index.js` | DSH 插件 Host 半：同源 Fetch 路由 `/api/dsh-sovits`（health / speak / settings-set / restart / shutdown / client-error）、设置持久化、worker 生命周期 |
| `client.js` | DSH 插件 Client 半：喇叭按钮、音色下拉、设置页 |
| `locale/`, `icon.svg`, `package.json`, `cordis.patch.yml` | bundle 元数据 |
| `tests/host-check.mjs` | 假 ctx + 真 worker 的 Host 半离线自检 |
| `tests/client-check.mjs` | 假 React/浏览器的 Client 半离线自检 |
| `engine/worker.py` | 本地 HTTP worker（`GET /health`、`POST /speak`、`POST /warm`、`POST /shutdown`） |
| `engine/engine.py` | 推理与合成流水线（分块、语速、音量之外的音调、缓存、显存兜底） |
| `engine/vendor/` | 从上游 so-vits-svc 复刻的推理代码，见 [NOTICE](NOTICE) |
| `engine/test_source.py` | 引擎离线自检（不出临时文件、波形非静音） |

## 安装

### 1. 环境

- Windows 10/11，NVIDIA 显卡（**6 GB 显存够用**，实测 RTX 2060 6 GB）
- Python **3.10**（3.11+ 会撞 `np.int` 一类历史问题；3.10 是与 torch 1.13/cu117 配套的版本）
- 一台能连外网的环境（edge-tts 在线取源语音；失败时会自动回退到 Windows SAPI）

```powershell
cd engine
py -3.10 -m venv venv
.\venv\Scripts\python -m pip install torch==1.13.0+cu117 --extra-index-url https://download.pytorch.org/whl/cu117
.\venv\Scripts\python -m pip install -r requirements.txt
```

### 2. 模型放哪

- **HuBERT-Soft**：下载 `hubert-soft-0d54a1f4.pt`
  （[bshall/hubert releases](https://github.com/bshall/hubert/releases/tag/v0.1)），放到 `engine/models/`。
- **音色**：每个角色一个目录，里面放 `config.json` + `G_*.pth`（32 kHz 模型）。
  默认扫描 `E:\TOOL\AI\碧蓝档案sovits\0303`，用环境变量 `SOVITS_MODELS` 指到你自己的目录：

```powershell
setx SOVITS_MODELS "D:\my-voices"
```

  目录名 → 显示名/音调的映射在 `engine/engine.py` 的 `VOICE_META` 里；不在表里的目录也会被自动收进列表，显示名就用目录名。
- 目录内自带 `hubert-soft-*.pt` 的优先用自带的，否则用 `engine/models/` 里那份。
- **只支持 32 kHz 的 so-vits-svc 模型**（`models.py` 里 32000 Hz / `upsample_rates [10,8,2,2]` 是写死的）。

### 3. 装插件

把仓库放到任意目录，然后在 DSH 里装本地 bundle（`plugin_manager` 或设置页的插件列表）：

```
install_bundle  target: link:<本仓库目录>
```

- 仓库根目录本身就是 bundle（`package.json` + `cordis.patch.yml`），`index.js` 默认把 worker 目录定成**自己旁边的 `engine/`**；如果你的引擎装在别处，改设置页「高级 → worker 目录」即可。
- 装完刷新页面（`Ctrl+R`）：回答下方出现喇叭，输入框下方出现音色下拉，设置里多出「语音朗读」。

### 4. 先用自检确认引擎能跑

```powershell
cd engine
.\venv\Scripts\python test_source.py
```

应当打印出「临时目录残留 0」和非静音波形统计。再单独起 worker：

```powershell
.\venv\Scripts\pythonw worker.py --port 8765
```

`GET http://127.0.0.1:8765/health` 应返回 `ok/ready/device/voices`。

## 性能（RTX 2060 6 GB 实测）

| 场景 | 音频时长 | 端到端耗时 |
| --- | --- | --- |
| 234 字 | 50.9 s | **4.79 s** |
| 317 字 | 68.4 s | **5.86 s** |
| 380 字（含切模型） | 79.9 s | **8.0 s** |
| 同一段再点一次（结果缓存） | — | **0.17 s** |

rtf ≈ 0.09。为此做了这些事：

1. **fp16 推理**（`torch.autocast("cuda", float16)`，显存 2362 → 1476 MiB）。so-vits 的随机时长预测器带噪声，固定种子后 fp32/fp16 波形相关系数 `1.0000`，即只快不变声。
2. **`torch.backends.cudnn.benchmark = False`**：每块音频长度都不同，benchmark 会对每个新长度 autotune 1.8–4.8 s，是当时最大的一次性开销。
3. **warmup 用 21 s 音频**（不是短音调），把首次显存块分配与 cuDNN 图一次性摊掉。
4. **edge-tts 对冲取数**：同一句两路并发取第一个成功的，最多两轮、总预算 12 s，再不行才回退 SAPI（该接口约 50% 概率抽风）。
5. **20 s 分块 + 按语速自适应字数**，块大小随语速变化；单块显存超限时自动对半重试。
6. **流水线**：后台线程并行取源语音，主线程按顺序转码，网络等待被 GPU 计算盖住。
7. **结果 LRU 缓存**（6 条），重复点同一条回答瞬时返回。
8. **音频不落盘**：源语音在内存里解码（soundfile `BytesIO`，失败走 ffmpeg `pipe:0 → pipe:1`），只有 SAPI 兜底才写临时 wav 并立即删除；worker 启动时会清扫超过 10 分钟的陈旧临时目录。
9. **空闲自动退出**：默认 15 分钟没人朗读就自己关掉，把 ~390 MB 内存和 ~2.6 GB 显存还给桌面和游戏；下次点喇叭由宿主自动拉起（设置页可改，0 = 常驻）。

## 已知限制

- 只支持 32 kHz so-vits-svc 模型；48 kHz 模型的结构不同，用不了。
- Windows 专有的部分：SAPI 离线兜底（comtypes / PowerShell）；其它平台只能走 edge-tts。
- 应用刚启动后第一次点喇叭有 10–20 s 冷启动（要加载 667 MB 的 G 模型 + HuBERT），之后走缓存。
- 长回答只读前 N 字（默认 1200，可在设置页改）。
- 每个音色进程内最多缓存 2 个模型（LRU），切着玩会反复加载。
- 空闲退出之后第一次点喇叭要重新加载模型（10–20 s）；不想等就把设置页的「空闲自动退出」改成 0。

## 来源与致谢

**这不是我从零做出来的东西**，推理部分是照着上游复刻 + 修补的，插件与流水线是我加的。
完整的逐文件版权归属见 [NOTICE](NOTICE)。

- **推理代码**：[innnky/so-vits-svc](https://github.com/innnky/so-vits-svc) 的 32k 分支（SoftVC VITS Singing Voice Conversion，作者 innnky / Jingyi Li，MIT）。
  - `engine/vendor/` 里的 `models.py` / `modules.py` / `attentions.py` / `commons.py` / `hubert/` / `vdecoder/hifigan/` 来自该仓库；
  - 我删掉了训练与训练集相关依赖，重写了 `utils.py`（只留 `f0_to_coarse` / `load_checkpoint` / `get_hparams_from_file`），把 `hifigan/utils.py` 里的 matplotlib 改成延迟导入，把 `np.int` 换成 `np.int64`。
- **声码器**：NSF HiFiGAN，上游引自 [openvpi/DiffSinger](https://github.com/openvpi/DiffSinger)（so-vits-svc 自带该实现）。
- **内容编码器**：HuBERT-Soft，来自 [bshall/hubert](https://github.com/bshall/hubert)（模型文件需自行下载，不在本仓库）。
- **源语音**：微软 edge-tts 在线接口、Windows SAPI 本地语音。
- **本仓库不含任何音色模型权重**（`G_*.pth`、`hubert-soft-*.pt` 都没有传）。
  ‼ 你训练或使用的角色音色，版权与使用授权归各自权利人；拿别人的模型对外发声前请先取得授权。

## 更新记录

- `2026-10-28` v0.1.0 — 首个公开版本：喇叭朗读、音色下拉、设置页（音色/音调/语速/音量/源语音/字数/高级）、pythonw 无窗口、内存取流不落盘、fp16 + 20 s 分块 + 对冲取数提速（rtf 0.09）。
- `2026-10-28` v0.1.1 — 设置页加「空闲自动退出」（默认 15 分钟，环境变量 `SOVITS_IDLE_SECONDS`），闲置后释放显存与内存；`tests/host-check.mjs` 的 settings 往返改成原样备份/还原真实配置文件，不再把无关字段重置成默认值。
- `2026-10-28` v0.2.0 — 新增「发到 QQ 当语音」：Host 半起一个 OneBot 透传中转（默认 3002），按概率把 `send_private_msg` / `send_group_msg` 的文字段换成 so-vits 合成的 `record` 段，图片照发；设置页加概率 / 字数上限 / NapCat 地址 / 中转端口四项与监听状态。
- `2026-10-28` v0.2.1 — 设置页打开时重新向宿主取一次设置（之前显示的是页面加载那一刻的快照，手改 `settings.json` 后界面还是旧值）；用户动过的字段不再被后台快照覆盖。
- `2026-10-28` v0.2.2 — 日语口癖的读法：`desuwa` / `desu no` / `desuno` / `nanodesu` / `arimasu wa` / 单独一个 `desu` 会先改写成对应假名，只给这一小段换日语源语音（`ja-JP-NanamiNeural`），其余仍用用户选的源语音，拼成同一段源音频后照常过 so-vits 转换。中文源语音读假名会直接输出空文件（实测），所以离线 SAPI 兜底时这些片段改读罗马字。
- `2026-10-28` v0.2.3 — 拼接裁边：每段源音频首尾自带静音（中文句尾约 0.5 s、日语短词前约 0.3 s），直接拼接会在句子中间留出近 1 秒空档。现在拼之前用 `_trim_edges()` 按「峰值 2% 以下算静音」把每段首尾裁掉、两端各留 6 ms，间隙 30 ms——同一句里「句子→口癖」的空档从 830 ms 降到 40 ms 量级。
- `2026-10-28` v0.2.4 — 停顿做成可调：设置页新增「口癖前停顿」(`jaGapMs`，0–200 ms，默认 30)，贯穿设置页 → 宿主 `/api/dsh-sovits` → worker `/speak` → `engine.speak(ja_gap_ms=…)`，并计入结果缓存 key（改完立刻重合成）。实测拼缝 ≈ 设定值 + 10~20 ms。

## License

MIT，见 [LICENSE](LICENSE)。
`engine/vendor/` 下的文件保留上游 MIT 版权声明；原作者若认为本仓库的用法不妥，我这边就转私有或删除。
