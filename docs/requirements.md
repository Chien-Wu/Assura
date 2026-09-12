# LegalMate — MVP 需求

更新日期：2026-09-12。

GitHub 版本包含可執行的 Web app 與需求文件。文中的原始 `web/` 路徑對應本 repository 根目錄；`sample_form/` 與研究資料仍保留在原工作區，未隨程式碼上傳。

本文件記錄本次對話已確認的需求，以及為落實需求提出的技術方案。產品範圍與 `IDEA.txt` 不一致時，以本文件記錄的最新使用者決定為準。第 1–7 節記錄需求與初始方案；第 8 節記錄實作進度。

## 1. 已確認的產品範圍

- **只做 Web。** 使用者透過瀏覽器操作，不開發原生 iOS／Android app。
- **主要使用者是剛下班的 support worker。** 開始時，這次班次的表單內容是空白的。
- **核心體驗是一次完整語音對話完成紀錄。** AI 在同一段對話中聽取敘述、填表、追問缺項、接受更正及確認內容。
- worker 不需要先寫好 shift note，也不需要每答一題就停止錄音或切換到另一個填表步驟。
- **Worker 與 Manager 使用不同視窗。** Worker 在 `/worker` 訪談及填寫紀錄；Manager 在 `/manager` 操作管理看板。根目錄提供兩個入口，可各自開啟獨立瀏覽器分頁／視窗；worker 畫面不放主管控制項。
- **主管端先做實用的簡單版本。** 本次新增事件覆核、通知時間線、原始對話與編輯紀錄、限制性措施及月報／nil-return 提醒；進階趨勢分析仍非本次範圍。
- **正式表單仍由使用者準備。** 尚未確認欄位、必填條件、條件式問題、版面及輸出格式。專案內的 `sample_form/` 是參考材料，不代表已選定正式模板。
- **全部英文。** 介面、語音對話及產出紀錄均使用英文。
- **先做簡單版本。** 使用者已確認 ElevenLabs API key／Agent 尚未準備，先實作其餘部分；語音不可用時須如實標示。

## 2. Worker 的主要流程

1. 開啟這次班次的空白表單，按「開始語音紀錄」。
2. 系統取得麥克風權限，建立對話。已知的 worker／個案／班次背景可供確認；缺少的資訊在對話內詢問。
3. AI 先邀請 worker 自由描述這次班次，不要求照欄位順序回答。
4. 每輪取得新資訊後更新同一份表單草稿，畫面同步顯示已填內容。
5. AI 根據仍缺少的資料、模糊描述及矛盾處提出下一個問題；已清楚回答的資訊不重問。
6. worker 可隨時口頭更正，例如「剛剛時間講錯，是五點結束」。修正應更新原欄位。
7. AI 在同一段對話中讀回重要內容及仍待確認的項目，讓 worker 更正或明確確認。
8. worker 確認當前版本且後端儲存成功後，顯示完成的紀錄，並讓主管端可查閱。

### 資料與完成條件

- 草稿可持續儲存；「結束通話」本身不代表 worker 已確認內容。
- 沒有提到的事情保持未知，不能自動填成「沒有發生」。AI 不得為了填滿表單推測事實。
- 明確的「不知道／不適用」與未回答應分開記錄；是否容許完成，依正式表單的欄位規則決定。
- worker 確認的是特定版本；確認前又修改資料時，須更新讀回內容並重新確認。
- 紀錄已完成與內容是否需要主管覆核分開表示，不把完成紀錄等同全面合規認證。
- 斷線或工具失敗時保留已成功儲存的草稿，顯示真實狀態。恢復後接續同一筆紀錄，不能靜默建立重複紀錄。

## 3. 建議的最小畫面範圍

以下是對「Web、worker 優先、主管簡單」的初步落地方案。

| 畫面        | 第一版內容                                                             |
| ----------- | ---------------------------------------------------------------------- |
| Worker 入口 | 開始這次紀錄、返回未完成草稿；已知班次資料可作為背景。                 |
| 語音交班    | 開始／靜音／結束、連線及儲存狀態、對話文字、同步表單草稿、待補項目。   |
| 紀錄詳情    | 已確認內容、確認時間、待覆核項目。文件匯出形式待正式模板確認。         |
| 簡單主管頁  | 紀錄清單、基本狀態篩選、點開查看內容及待覆核項目；從實際儲存資料讀取。 |

## 4. 語音技術方案（建議）

### 4.1 系統分工

- **Web 前端：**處理麥克風、播放 AI 語音、呈現對話與表單，管理連線狀態。React 與 `@elevenlabs/react` 是可行的串接選項，完整前後端框架尚未鎖定。
- **ElevenLabs Agents：**管理雙向語音、辨識與回覆、輪流說話及工具呼叫，依表單狀態進行訪談。[React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react)
- **我們的後端：**提供表單定義與受授權的背景資料，驗證欄位、儲存草稿、計算缺項、管理版本及確認狀態。
- **資料庫：**保存 application session、班次／表單資料、版本與確認紀錄。資料庫和部署供應商待實作時選定。
- **文件輸出：**使用確認後的結構化資料套入選定模板；格式與欄位映射等待正式表單。

### 4.2 一次對話的執行順序

1. 前端向我們的後端建立 application session／空白草稿。後端確認使用者可操作該紀錄，取得 ElevenLabs 的 conversation token。
2. 前端用 token 建立 **WebRTC** 語音連線，麥克風與 AI 聲音在瀏覽器和 ElevenLabs 之間傳輸；ElevenLabs API key 留在後端。此 token 是 Agents 的通話 token，不是獨立 Scribe 的轉錄 token。[React SDK 連線方式](https://elevenlabs.io/docs/eleven-agents/libraries/react)
3. Agent 取得這份表單的欄位規則與已知背景，開始訪談。
4. Agent 每取得一組可用的新答案或更正，即在通話中呼叫後端工具，提交欄位變更。後端驗證、存檔並回傳最新版本、缺項與需釐清的內容。[Webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools)
5. Web 前端接收後端的最新表單狀態並重新顯示。建議用 SSE 推送，或在 MVP 使用短輪詢；資料庫中的版本是共同依據。
6. Agent 根據工具結果決定下一個追問，再把問題說給 worker 聽。對話持續，不需要 worker 重新按錄音。
7. 完成收集後，後端建立待確認版本。Agent 讀回，取得針對該版本的明確口頭確認，再呼叫完成工具。
8. 後端儲存成功才回覆完成；Agent 告知 worker，前端及主管頁讀取同一份結果。

```mermaid
sequenceDiagram
    participant W as Worker／Web
    participant B as 我們的後端
    participant E as ElevenLabs Agent
    participant D as 資料庫
    W->>B: 開始紀錄
    B->>D: 建立草稿與 application session
    B->>E: 取得 conversation token
    B-->>W: token 與草稿 ID
    W->>E: 建立 WebRTC 雙向語音
    E->>B: get_form_context
    B-->>E: 表單規則、已知背景及目前草稿
    loop 同一段訪談
        W->>E: 說明或更正
        E->>B: update_and_check_form
        B->>D: 驗證並儲存新版本
        B-->>W: 同步最新表單
        B-->>E: 缺項、矛盾或可準備確認
        E-->>W: 針對缺口追問
    end
    E->>B: prepare_confirmation
    B-->>E: 待確認版本與讀回內容
    E-->>W: 讀回並請求確認
    W->>E: 明確口頭確認
    E->>B: finalize_form
    B->>D: 儲存確認版本
    B-->>E: 已儲存成功
    B-->>W: 更新完成狀態
    E-->>W: 告知完成
```

### 4.3 建議的通話中工具

| 工具                    | 職責                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `get_form_context`      | 取得表單定義、已知班次背景及目前草稿。                                 |
| `update_and_check_form` | 接收增量答案／更正、驗證與存檔；回傳版本、缺項、矛盾及下一題所需資訊。 |
| `prepare_confirmation`  | 檢查是否可進入確認，產生對應特定版本的讀回內容。                       |
| `finalize_form`         | 驗證確認版本、完成條件與明確確認紀錄，儲存最終狀態。                   |

- 模型負責理解敘述及提問，後端負責正式狀態；不能只靠 Agent 說「完成了」來判定完成。
- 工具必須等待後端結果，再決定下一句；失敗時不得宣稱已儲存。
- 工具請求應驗證呼叫身分及 application session 的存取範圍，不能單憑模型傳入的 worker／個案 ID 授權。
- 更新帶版本與冪等識別，避免重試、重複工具呼叫或較晚抵達的舊更新覆蓋新答案。
- 保存 application session 與 ElevenLabs conversation ID 的對應。重新連線可能產生新的通話 ID，但應接續原本已儲存的草稿。
- Data Collection／Evaluation 作為通話後的分析選項，不作為通話中填表和追問的依賴。[Post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)

## 5. 表單與檔案尚待確定的部分

- 正式模板、欄位名稱／型別、必填規則、條件分支、確認與輸出要求，由準備中的表單決定。
- 實作時以表單 schema 驅動畫面、工具欄位驗證和缺項檢查，避免三處各自維護不同規則。
- 在模板交付前可做示範 schema，但須標為暫定，不把示範欄位當成正式需求或官方要求。
- 照護計畫、BSP 等既有文件可作為受授權的背景資料；本次 worker 交班流程不以先上傳文件為必要步驟。
- 匯出 PDF／DOCX、是否需填回原檔，以及是否需額外事件表單，均待正式模板及工作範圍確認。

## 6. 第一版驗收重點

- worker 能從空白表單開始，在一段語音訪談中敘述、補答、更正及確認。
- 一段敘述能填入多個相關欄位；表單顯示的是後端已接受的最新資料。
- AI 會追問必要缺項，且不把未提及內容填為否定或自行猜測。
- 口頭更正能取代錯誤答案，並使舊的待確認版本失效。
- 掛斷、拒絕麥克風權限、網路或工具失敗不會把草稿誤標成完成。
- 確認後只產生一份對應版本的完成紀錄；主管簡單清單可以開啟同一份內容。
- 正式欄位覆蓋率與完成條件的驗收，待表單交付後補齊。

## 7. 本次範圍與後續事項

- 本次先按 Web 內語音對話設計；實際電話號碼、撥入／撥出、Twilio／SIP 未列為需求。
- 原生手機 app、進階主管分析、正式月報自動提交及政府系統自動提交不列入目前最小流程。管理看板提供月報／nil-return 準備提醒，不代表已提交。
- 後續需確定：正式表單、登入／班次資料來源、展示用資料、模型／聲音配置及資料保留設定。

## 8. 第一個開發切片（2026-09-12）

- Web 原始碼放在 `web/`，以 Sites 的 Vinext starter 與 D1 儲存建立初版。
- 本次先實作英文示範表單、草稿儲存、欄位與條件檢查、版本化確認、紀錄清單與文字匯出。
- 正式模板仍待提供；當前欄位與完成規則明確標為 demo，不作為官方表單要求。
- 私人展示版的紀錄依登入使用者隔離；簡單主管頁目前查看該使用者的紀錄，尚未加入跨 worker 的組織角色管理。
- 初始切片先保留手動填表；最新語音接入進度見 8.2。
- 私人 Sites 預覽若使用語音，建議先由 client tools 經登入瀏覽器轉呼叫現有 API；前述 server webhook 方案待公開 callback 與授權配置支援後再接。

### 8.1 ElevenLabs 帳號設定進度

- 使用者已明確同意 ElevenAgents 條款；已建立並發布 `LegalMate Shift Notes — Demo` Agent 的英文訪談設定。
- 已建立四個等待回應的 client tools：`get_form_context`、`update_and_check_form`、`prepare_confirmation`、`finalize_form`。
- Agent 要求驗證，採後端取得短效 token 的接入方式；使用者之後已填入 API key，接線進度見 8.2。
- Web 保留手動填表及確認流程。Agent 設定詳見 `docs/elevenlabs-agent.md`。

### 8.2 語音接線（2026-09-12）

- 使用者已在 `web/.env.local` 填入 API key；後端已成功取得 ElevenLabs conversation token。金鑰不進 Git 或前端。
- 已加入 React SDK／WebRTC、開始／靜音／結束通話、即時文字及四個 client tool 執行器，經登入瀏覽器呼叫同一組儲存 API。
- 一段通話綁定同一草稿及 provider conversation ID。更正清除舊確認；結束通話等待既有存檔收尾，再容許重開。
- 口頭完成要求新一輪明確說出 **I confirm this shift note.** 後端核對最新 note revision、confirmation ID、voice session revision 及 SDK 使用者轉錄；不是只接收模型產生的 confirmed 布林值。
- 轉錄證據存於 D1，並非獨立音訊驗證；SDK 的 speaking/listening 不能嚴格證明每字均已播放。實際追問、朗讀與辨識品質仍須由使用者用麥克風跑一輪驗收。
- 前述 webhook／SSE 是初始建議；本次 MVP 採 client tools 與 API 回應同步，未加入 webhook 或 SSE。
- 正式表單、跨 worker 主管權限、資料保留與正式個資使用仍待後續確認。測試步驟在 `web/docs/voice-integration.md`。

### 8.3 暫時文字測試模式（2026-09-12）

- 使用者要求把說話暫時改成打字，方便測試表現，保持相同思考／訪談流程。
- 預設 Text · Test mode，可在開始前切回 Voice。兩者使用同一 ElevenLabs Agent、model、system prompt、四個表單工具與版本確認規則。
- 文字使用 signed WebSocket URL 與 textOnly，不要求麥克風；使用者送出的文字先保存，再交給 Agent。確認證據標示 text，與語音轉錄分開。
- 畫面提供可捲動對話、輸入框、Send、Enter 送出、Shift + Enter 換行。更正仍使舊確認失效；閱讀最新摘要後輸入 I confirm this shift note. 才完成。
- 文字測試可驗證理解、追問、工具存檔及更正；不涵蓋辨識準確度或聲音播放延遲。
- 驗證：11 項表單／確認邏輯測試、36 項語音 API 相容性檢查通過；真實 Agent 文字對話完成填表、修改結束時間、重新讀回及文字確認。觀察到 Agent 可能只宣告將準備摘要而結束回合，測試用下一則使用者訊息要求 review 後可完成；app 不自動插話，也未修改 Agent 指令。

### 8.4 Shift-note spec 與分開的管理視窗（2026-09-12）

本次使用者要求實作 `/Users/chien/Downloads/shift-note-agent-spec.md`，並新增 management board；後續明確要求 worker 與 manager 各自使用不同視窗。以下為本次交付範圍，取代前述單一簡單主管清單方案；發布與驗證結果以本次完成回報為準。

- `/`：選擇 Worker workspace 或 Manager board；兩個入口可開在獨立瀏覽器分頁／視窗。
- `/worker`：空白班次草稿、四位虛構個案的 profile picker、文字／語音訪談、同步欄位、限制性措施細節、覆核確認及 My notes。預設保留 Text · Test mode；Voice 使用相同 Agent、工具與記錄規則。
- `/manager`：獨立管理看板，包含待覆核事件、嚴重度篩選、記錄查閱、原始 transcript／draft_v0／修改歷程、事件及通知時間線、限制性措施月報與無紀錄時的 nil-return 核對提醒。
- **此 demo 使用相同登入帳號、依記錄 owner 隔離資料。** 兩個視窗是工作介面分流，不是已完成的 worker／manager 角色權限系統。跨 worker 團隊資料、組織管理及正式 RBAC 仍需之後實作。
- **即時通知先使用 in-app manager inbox。** 偵測到候選事件即可入列，不等草稿確認；未接 email、Slack、SMS 或其他外部通知。不能宣稱主管已讀、已收到外部通知或已通知 Commission。
- 分開保存事件發生、app 捕捉、inbox 入列、provider 實際知悉、Commission 通知等時間；主管輸入實際知悉時間與來源，不把 inbox 時間直接當法定知悉時間。
- 所有欄位新增 `stated_positive`、`stated_negative`、`not_reviewed`。未提及預設 Not yet reviewed；「No incidents／None」必須有明確 worker 證據，不能由沉默或「all good」推定。
- 口語中的鎖門、限制取得物品、抓握或其他限制性措施也要偵測。worker 只確認觀察事實，不負責判斷是否 reportable；不同意分類時保留原始事實與候選旗標，交主管覆核。
- 新增限制性措施資料、計畫項目與使用限制比對。個案計畫、州授權及本次使用是否符合限制分開核對；worker 不知道計畫不直接等於未授權。
- 使用虛構 profile 做最多三次風險優先的觀察性追問；完整敘述不加問無必要問題。不得診斷、提出臨床假說或增加 worker 未說的因果。
- 保存 app 層 append-only 對話、首次準備覆核的 `draft_v0`、每次欄位前後值及編輯者／時間；風險內容被移除或矛盾的否定敘述交主管覆核。開場明示 transcript 被記錄及保留，說明原始陳述可在後續編輯後保護 worker。
- 保留至少七年的 metadata；四個示範個案未提供 DOB，未成年延長保留條件仍標為待核對。這是 demo 的保留策略，不能宣稱「至 25 歲」是所有 NDIS 記錄的統一法定要求。

### 8.5 規格中的申報文字修正

- 未授權限制性措施一般為 provider 知悉後五個工作天；造成 harm 或屬其他 24 小時通報類別時，可能適用 24 小時。未知 harm 或授權狀態應保留不確定性，交負責人評估，不能由模型作最終法律判斷。[NDIS Commission guidance](https://www.ndiscommission.gov.au/rules-and-standards/reportable-incidents-and-incident-management/reportable-incidents)
- 月報與 incident reporting 可同時適用；當月沒有 app 記錄不等於實際零使用，因此只能提醒核對 nil return。使用超出計畫的限制仍需事件覆核。[Implementing providers](https://www.ndiscommission.gov.au/rules-and-standards/behaviour-support-and-restrictive-practices/rules-implementing-providers)
- 新 Agent prompt 的可複用原文放在 `docs/elevenlabs-system-prompt.txt`；開場放在 `docs/elevenlabs-first-message.txt`。正式表單、真實個資使用、clinical sign-off 及正式組織權限不由此次 demo 自動完成。
