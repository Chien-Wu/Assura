# 原生 Workflow 後端設定與測試

測試日期：2026-09-13 UTC／2026-09-14 Melbourne。

## 目前結論

Main 加六個專責節點、六種 risk draft、兩個 Webhook 及 D1 共用記錄已完成隔離實作。**目前尚未達到正式上線驗收。** 後端驗證通過，但真實模型測試曾出現重問、推論成事實、錯用事件與無法完成存檔／返回 Main 的情況。不能只以 `sourcesFromWorker:true` 或一次成功對話推論內容已正確。

正式 agent `LegalMate Shift Notes — Demo` 保持原本只有 Start 的 workflow；最終唯讀核對版本為 `agtvrsn_4101m2ddzt3me4sadhkjwfsg9t3q`。正式 DB、既有 recorder UI 與正式 note confirmation 流程沒有切換。

隔離 agent 名稱：`LegalMate — Backend workflow test`。
ID：`agent_1401m2dg91jjeve939wtx6t9qwh6`。

## 已完成的接線

- 由 API 建立 Start → Main ↔ 六個 specialist：Incident/Safeguarding、Health/Wellbeing、Medication、Behaviour/ABC、Restrictive Practice、Service Exception。
- 同一 agent、conversation 與聲音；專責節點直接發問。沒有另一個後端 LLM 逐輪產生問題再交 Main 複誦。
- `get_case_context` 與 `save_risk_form` 是實際 HTTPS Webhook。測試請求到達實際 built Worker，再寫入隔離 D1；不是 client tool 的記憶體假回覆。
- case 依 owner 與 draft note 綁定；同一事件可共用多張表的共同事實，獨立事件另建 event。表單有 known／unknown／not_discussed／not_applicable。
- 保存依 revision 做並行檢查，相同請求去重；session token 短效、存 hash、可關閉；錯誤修正及呼叫次數有上限。
- 表單編輯來源可綁定 `field_path`，避免把「預定給藥時間」拿來支持「事件發生時間」。這是欄位來源限制，不能保證所有自由語句都被正確理解。
- risk draft review 綁定 case 與 note 最新版本；不會自行確認 General Note。

程式位置：[case/schema](../lib/workflow-case.ts)、[後端 API](../lib/workflow-server.ts)、[API 設定產生器](../scripts/experiments/workflow-backend-config.mjs)、[隔離實測 runner](../scripts/experiments/workflow-backend-live.mjs)。完整對接說明：[elevenlabs-workflow-integration.md](./elevenlabs-workflow-integration.md)。

## 自動化後端驗證

| 檢查                                                     | 結果                                           |
| -------------------------------------------------------- | ---------------------------------------------- |
| 全專案 unit tests                                        | 165／165 通過，其中包含新增 workflow case 驗證 |
| 實際 built Worker API 檢查                               | 60 項通過，provider 連線建立採 mock            |
| 六種 schema、共享事件、獨立事件                          | 通過                                           |
| 權限隔離、關閉／過期 session、版本衝突                   | 通過                                           |
| 同請求並行去重、錯誤重試限制                             | 通過                                           |
| 關閉並重開 D1 後資料仍在                                 | 通過                                           |
| 活躍通話阻擋 review、新 session／note 更正使 review 過期 | 通過                                           |
| UTF-8 中文跨 HTTP chunks                                 | 通過，不再把中文字元損壞後保存                 |
| TypeScript、修改範圍 ESLint、正式 build                  | 通過                                           |

Migration `0010_chubby_goblin_queen.sql` 新增三張 workflow 表與索引，只在測試 D1 套用。本次沒有部署正式 migration。

## 真實 ElevenLabs 測試發現

完整六類第一輪資料：[2026-09-13T13-57-33-257Z](../test-results/workflow-backend/2026-09-13T13-57-33-257Z/summary.json)。後續三類回歸：[2026-09-13T14-01-41-200Z](../test-results/workflow-backend/2026-09-13T14-01-41-200Z/summary.json)。使用合成 worker／participant 和文字輸入，接收真實語音輸出。

| 情境                  | 已觀察到的成功                                                                        | 尚未通過的內容／穩定性檢查                                                 |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Medication            | 已有一輪保存 unknown、沿用表單時間、Main 更正 1:10→1:20、第二事件另建與再次接手均通過 | 重跑仍出現錯用事件／缺漏欄位；不能視為穩定通過                             |
| Incident/Safeguarding | 回歸確認保存與返回 Main                                                               | 曾重問已給的 10 am，並把泛稱「不知道更多」套到多個未談欄位                 |
| Health/Wellbeing      | 專責節點發問、保存、返回 Main                                                         | 把 new change 寫成 Sudden；觀察時間與發生時間混用                          |
| Behaviour/ABC         | 專責節點發問、保存、返回 Main；主要事實忠於來源                                       | 會重問已提過的等待情境，部分領域欄位未填但共同敘述已有資料                 |
| Restrictive Practice  | 專責節點發問、保存、返回 Main                                                         | 用約略持續時間推算結束時刻；將無可見傷勢誤放到監測方式                     |
| Service Exception     | 回歸確認實際 Webhook 保存與返回 Main                                                  | 曾只說要保存而未完成；回歸仍會問 worker 要選哪類 exception，且保存回覆偏慢 |

### 已修正的實作問題

1. 成功保存後 Main／Medication 反覆切換：啟用平台防循環，返回 Main 後等待新回覆。
2. 已預填但仍 pending 的表單被 Main 當成簡單更正：路由改為新事件／pending 必須先進 specialist；只有 handled／deferred 的簡單更正才由 Main 直接保存。
3. 已保存來源的欄位用途不明：新增可驗證的 `field_path`。
4. 工具串流／語音尚未結束就被測試當成完成：排除 heartbeat，追蹤 pending tools；保存回合必須有後端成功與實際回到 Main 後的回覆。
5. 測試 gateway 的 UTF-8 分段解碼：改用串流正確解碼並加回歸檢查。

### 模型比較

原模型是 `qwen35-397b-a17b`。已確認帳戶可用 `gpt-4.1-mini` 且未被標示棄用，再進行比較。mini 模型也產生錯誤 schema 或不支持該欄位的來源，後端拒絕寫入；模型替換本身沒有解決所有問題。

Gemini Flash 比較也未通過。[完整失敗紀錄](../test-results/workflow-backend/2026-09-13T14-10-04-103Z/failure.json) 顯示：

- 第一個事件、Main 更正、第二個事件都曾有實際 Webhook 保存，最後 D1 revision 到 11。
- 但把 supervisor 聯絡時間存成 discovered_at，後續更正又只改 discovered_at，原本 notifications 仍留舊時間。
- 第二事件已存成 deferred，語音也說已保存，卻沒有原生返回 Main 事件；測試因此失敗。
- 第一個問題首段音訊約 6.2 秒，第一筆保存後回覆約 11.0 秒。此輪 thinking_budget 為 null，不能視為已關閉思考。官方支援 Gemini 2.5 Flash 使用 0 關閉思考，但本次未對該設定做實測，不宣稱它能消除上述內容或路由錯誤。
- 此輪在 Medication 的失敗處中止，其他五類沒有在 Gemini 上執行；不能稱為三個模型都完成六類比較。

最後隔離配置：workflow-backend-v5、gemini-2.5-flash、版本 agtvrsn_6601m2dhnzfweb3vaw4y9kvx0z77。這是最後一輪實驗配置，不是推薦上線版本。三個模型的實測均未達完整驗收；沒有選定正式替換模型。

目前保存寫入會驗證 schema、來源存在及 form-edit 欄位限制；自由語句是否支持模型填入的語意仍有缺口。下一個工程重點是更明確的 typed 欄位工具、可核對的事件狀態與返回條件，完成後再測，而不是繼續只改問法。

## 延遲如何解讀

原模型完整六類第一個問題的首段音訊約 **0.78–1.37 秒**。這是送出文字到收到音訊，不含麥克風、STT、停頓判定、播放緩衝。部分回覆有冗長前言，因此首段音訊時間也不等於使用者已聽到核心問題。

保存之後的回覆明顯較慢；Service Exception 回歸一次約 **13.9 秒**才收到首段音訊。不能只展示第一個問題的低延遲。Webhook 本身與模型產生參數／後續語音的時間分別保留在每個 run 的紀錄，測試 tunnel 延遲也不等於正式部署延遲。

## 使用限制與下一個驗收門檻

目前是可重現的隔離 prototype。開關 `LEGALMATE_WORKFLOW_ENABLED` 預設關閉；正式 App 尚未接到 workflow session 與六種可編輯表單。Dashboard 的圖完成，不代表單獨開 Preview 就有 LegalMate 身分、來源、共享記錄或可用 Webhook token。

每次 live runner 會開啟只允許兩個 Webhook 路徑的暫時 gateway，結束後關閉所有測試 session、Worker 與 tunnel。agent 中保留的暫時 Webhook URL 隨後不可用。這個設計用於隔離測試，不是常駐服務。

正式啟用前，仍需在固定配置上重複通過來源語意、時間區分、事件歸屬、未知／未談及、失敗恢復與返回 Main 的測試，再接上真實麥克風、表單同步及最後 review。下一步應優先改善欄位約束與 context 使用，避免加入另一條逐輪串接 LLM 的語音流程。
