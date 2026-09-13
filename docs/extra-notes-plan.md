# General Notes 與 Provider 標準 Extra Notes 規劃

記錄日期：2026-09-13。狀態：未來產品方向與表單需求草案，尚未實作。

## 1. 已確認的產品決定

- 每個班次先完成 **General Note**，有需要時再接續填寫 **Extra Notes**。
- **由 LegalMate 團隊提供一套標準表單，Provider 勾選該機構需要使用的 Extra Notes。** 初期採標準表單庫方向；Provider 自建欄位、上傳 Word／PDF 轉成表單不列為已確認需求。
- Provider 啟用表單與某一班次是否需要填寫，是兩個不同的判斷；不是勾選後每班都必須填完所有表單。
- 本次只記錄方向及使用者提供的素材，供未來設計、拆分工作及實作使用。

本決定更新 [需求文件](requirements.md) 中「是否需額外事件表單尚待確認」的早期方向；正式欄位、驗證、版面及輸出格式仍待定稿。

## 2. 來源與內容狀態

- 本次對話確認了第 1 節的產品方向。
- 使用者同時提供六類表單的觸發情況、提問、條件分支、主管欄位及跨表升級構想。完整原文另存為 [Extra Notes 使用者原始素材](sources/extra-notes-user-input-2026-09-13.txt)，保留原始文字與順序。
- 第 3–4 節是這份原文的索引與整理，不取代完整問題清單。原文沒有各表單標題；這裡的六類名稱依內容整理，其中 Restrictive Practice 原先是 Behaviour 表單的追加分支。
- 原文中的 NDIS／其他平台說明、通報時限、緊急處理及月報等敘述，屬使用者提供的規劃素材，本次未作法規或臨床查核，也不表示現有產品已具備這些流程。未來轉成正式規則時，需補上適用條件與經核對的來源。
- 第 5 節保留討論中提出的設計建議，第 6 節列出尚未決定的事項；不可把建議直接視為已批准的完整規格。

## 3. 標準表單庫草案

### 3.1 Incident Form

**來源觸發條件：**已造成或可能造成 participant 傷害；participant 行為造成他人嚴重傷害或其風險；虐待、疏忽、暴力或不當行為指控；near miss；不明傷勢；跌倒、噎到、失蹤、交通事故、感染／體液暴露；可能影響安全的財物、隱私、設備或環境事件；未授權 restrictive practice。

**Worker 資料：**

- 區分 Actual incident、Alleged incident、Near miss、Hazard identified，並記錄事件類別。
- 依時間順序描述事前、事中、事後的客觀事實；記錄實際影響，或沒有傷害時可能造成的傷害。
- 受傷者、部位、傷勢、症狀及目前狀況；立即措施；participant 現在是否安全（Yes／No／Unsure）。
- Participant 原話、溝通方式、意願、是否需要 advocate／家人／nominee／溝通支援，以及相關證據。
- Safeguarding 分支逐項蒐集死亡、嚴重傷害、虐待／疏忽、非法接觸／assault、sexual misconduct／grooming、限制性措施及計畫／授權情況等事實，不讓 worker 自行判定是否 reportable。
- 時間、地點、涉及者、證人及 participant consultation 等原文列出的紀錄範圍，在正式 schema 時補齊明確欄位。

**主管資料：**嚴重度、是否 reportable 及理由、provider 首次知悉時間、Immediate Notification／5 Day Form 提交時間、其他機關通知、調查負責人、原因／促成因素、可預防性、改善措施、participant 諮詢／更新／調查結果分享，以及結案日期與理由。

**來源升級構想：**安全狀態 No／Unsure，或 safeguarding 事實題任一 Yes／Unsure 時立即升級。對應通知對象、通道及時限待正式定義。

### 3.2 Health & Wellbeing Concern Form

**來源觸發條件：**健康、需求、外觀、情緒或功能改變，當下未必已構成事故。例如疼痛、行動能力、呼吸／意識、食慾／飲水、皮膚／傷口、排泄、癲癇頻率、睡眠／體重、情緒／行為、對平常服務的選擇或持續增加的支援需求。

**Worker 資料：**變化類別、平常基準與本次差異、首次發現時間、突然／逐漸／反覆、participant 原話、客觀觀察、是否超過 health plan 的 escalation threshold（Yes／No／Unsure）、已採取措施、取得的臨床建議、目前狀況，以及跟進人與時間。

原文區分一般客觀觀察與量測數值：血壓、體溫、血糖等資料，以工作者受訓及計畫要求為條件；不得由模型猜測。狀況選項保留 Resolved／Improving／Unchanged／Worsening／Unknown。

**來源分支：**急症連到 Incident 及緊急協助提示；藥物相關變化連到 Medication Variance；不明傷勢／疑似疏忽連到 Incident safeguarding；持續／反覆惡化交 manager／clinical lead 跟進及 support plan review。

### 3.3 Medication Variance Form

**來源觸發條件：**漏給、遲給、錯藥／錯人／錯劑量／錯時間／錯途徑、participant 拒絕、藥物缺失／遺失／灑出／掉落／損壞、儲存問題、MAR 紀錄錯誤、疑似副作用／過敏、PRN 超出授權參數、無法確認吞下、吐出或給藥後嘔吐。

**Worker 資料：**

- 原定藥物名稱、strength、dose、route、scheduled time（原文希望從 MAR 帶入；目前不代表已有 MAR 整合）。
- Variance 類型、原定與實際情形、何時／由誰發現、實際劑量／時間／途徑或 Not administered，以及目前症狀。
- 臨床建議的聯絡對象、時間、指示及執行情況；MAR 更新；受影響藥物的保管／標示；已通知誰；後續監測與跟進。
- 拒絕用藥分支：participant 所述原因、計畫允許的資訊與選擇、指定人員通知及即時健康風險。
- PRN 分支：authorised indication、事前非藥物策略、計畫劑量範圍、何時檢查效果、效果與副作用。

**來源分支：**錯人／錯藥／錯劑量或出現症狀時通知 clinical／on-call manager；有實際或潛在傷害時同時開 Incident；急救需求連到緊急協助提示。原文保留「拒絕用藥仍記錄並依計畫跟進，不能強迫服藥」的要求。

### 3.4 Behaviour / ABC Form（含 Restrictive Practice 分支）

**來源觸發條件：**BSP 指定 behaviour of concern；新行為、頻率／嚴重程度改變；practitioner 要求蒐集資料；需要記錄正向行為策略效果；使用任何 restrictive practice，或不確定介入是否屬 restrictive practice。

**Worker 資料：**是否列在 active BSP（Yes／No／Unsure／No active plan）；A 前因情境；B 可觀察動作與語言；開始／結束、duration、frequency；強度 Low／Moderate／High 及依據；傷害／威脅／財物損壞；使用的計畫策略及各項反應；C 後續情形；最後狀態；通知與 practitioner review 需求。

**Restrictive Practice 追加資料：**類型（Chemical／environmental／mechanical／physical／seclusion／unsure）、開始／結束、使用原因、先前較低限制性策略、active BSP、適用授權、是否依計畫條件／方法／時間執行、執行者／在場者、期間監測、傷害／distress、participant 與 worker debrief。

**來源分支：**傷害或嚴重傷害風險同時開 Incident；不在計畫、授權不足或未依計畫執行，標記 possible unauthorised restrictive practice 並交 compliance manager。保留每次使用及月報／nil-return 的規劃需求，與事件通報分開。

### 3.5 Complaint / Feedback Form

**來源觸發條件：**對服務、worker、管理、排班、收費、溝通不滿；不公平／不尊重／不當對待；服務品質或未提供服務；allegation；對先前處理不滿；正式或非正式投訴。「不想正式投訴」時，原文要求詢問是否希望機構記錄並處理 concern。

**Worker／接收者資料：**Complaint／feedback／suggestion／compliment、提出者角色（含 anonymous）、與 participant 關係、匿名／保密偏好、聯絡／溝通方式、interpreter／advocate／Easy Read 支援、事實及相關日期／服務／人員／地點、影響、期望解決方式、報復／服務中斷／威脅等安全顧慮、分享身分資料的同意、先前提出與回應、證據。

**主管資料：**接收／確認日期、風險評估、是否同時為 incident／reportable、負責人、調查／解決行動、與 complainant／participant 的更新、結果／理由、改善措施、review／appeal options、Commission／advocate 資訊、是否接受結果及結案日期。

**來源分支：**傷害、虐待、疏忽、性不當、威脅或 restrictive practice 連到 Incident safeguarding；服務未提供連到 Service Delivery Exception；被投訴 manager 不處理自己的案件，改派無利益衝突 reviewer；匿名投訴仍依現有資訊評估，不因無法聯絡而刪除。

### 3.6 Service Delivery Exception Form

**來源觸發條件：**Worker／participant no-show、遲到／提早結束、participant declined、無法進入、臨時取消、無替班、交通失敗、設備／電力／網路／環境中斷、重要 appointment 未完成、關鍵支援未提供，或實際時數／內容與 booking 不同。

**Worker 資料：**原定服務日期／起訖／類型、exception 類型、何時知道及誰提出／造成變更、實際起訖與完成支援、客觀原因、未提供的 critical support、安全影響、participant／nominee 通知時間與方式、對替代安排的同意、替代方式、結果及跟進人／時間。

**主管資料：**Continuity plan 是否啟動、替班搜尋、participant agreement、cancellation／billing classification、是否構成 incident、是否重複發生、roster／staffing／service agreement 改善及結案。

**來源分支：**關鍵支援缺失造成或可能造成傷害時同時開 Incident；no-show 且失聯並符合其風險計畫情境時連到 missing person／welfare check 流程；不滿連到 Complaint；同一 participant／worker 短期反覆發生時建立 quality trend alert（期間與門檻未定）。

## 4. 跨表關係索引

以下表示原始素材希望建立的關係，實際啟用政策及觸發規則尚待設計。同一情境可以同時需要多張表單。

| 來源情境                                             | 額外表單或處理                            |
| ---------------------------------------------------- | ----------------------------------------- |
| Health concern 出現急症，或不明傷勢／疑似疏忽        | Incident；後者走 safeguarding 分支        |
| Health concern 與藥物相關                            | Medication Variance                       |
| Medication variance 有實際／潛在傷害                 | Incident                                  |
| Behaviour／restrictive practice 有傷害或嚴重傷害風險 | Incident                                  |
| 可能未授權或未依 BSP 執行 restrictive practice       | Compliance review；保留 Incident 觸發關係 |
| Complaint 涉及安全、虐待或限制性措施                 | Incident safeguarding                     |
| Complaint 涉及服務未提供                             | Service Delivery Exception                |
| Service exception 造成實際／潛在傷害                 | Incident                                  |
| Service exception 引發不滿                           | Complaint                                 |

## 5. 討論中的設計建議（尚未全部確認）

1. **Provider 設定與班次觸發分開。**表單庫由我們維護，Provider 先勾選；規則再決定本次需要哪些已啟用表單。是否開放每班必填／條件必填／自行選填、負責角色及審核設定，留待設計。
2. **先寫 General Note，再引導補充。**可在背景辨識候選需求，完成一般紀錄後顯示清單及觸發原因。危險情境的提醒與既有風險捕捉不應等待補充表填完；完成／確認的確切切換時點仍待定。
3. **重用已有事實，只補問缺項。**帶入 participant、班次、時間與已陳述經過；帶入值可追溯到對話或來源紀錄，讓 worker 核對。Profile、BSP、MAR 的計畫資料與這次實際發生的事分開；未知值保留未知。
4. **每張表單分別保存與確認。**General Note 已完成、Extra Note 待補充、主管待審可以並存；掛斷後能接續。後續修訂影響已確認表單時，提示重新核對，不靜默覆寫。
5. **風險與表單分開建模。**風險可觸發多表，多個風險也可能屬於同一事件；完成表單、主管評估、實際通知與結案分開。跨表可以共用同一事件的事實與證據，但不自動合併同班次中不同事件。
6. **避免循環與重複建表。**Incident、Complaint、Service Exception 的交叉觸發需檢查既有關聯；後續重試或補答不能一直新增同一張表。
7. **保留模板及來源版本。**未來表單實例宜記錄使用的標準模板版本、Provider 設定及來源 note revision；新模板／設定不應改寫歷史確認內容。

## 6. 後續需要決定的事項

- 六類是否全部納入第一版、正式英文名稱、必填欄位及驗收案例；Restrictive Practice 保持 Behaviour 分支或另成可選表單。
- Provider 是否僅能開關，或能設定觸發／審核／分派；關聯表未啟用但出現安全事件時如何處理，不能把「未啟用」解讀為事件不存在。
- General Note「寫完」是草稿資料齊全、worker 確認後，還是整組表單共同確認；Extra Note 是否阻擋整個班次的完成狀態。
- Worker 能否自行新增、稍後補填、提出不適用及理由；誰可以核准免填、退回、重開或結案。
- 同一班次同類表單允許多筆事件的方式，以及跨班次的同一事件如何接續。
- Incident／Concern／Medication 等表單的追問預算；現有 General Note 的最多三題政策不可未經設計就套到全部 Extra Notes。
- Complaint 的匿名、身分分享、保密與利益衝突權限；不能直接沿用一般 provider managers 可見全部資料的方式。
- MAR／BSP／health plan 的來源、版本與整合方式；證據附件、表單輸出與留存要求。
- 緊急升級的負責角色、通知通道、送達／接手狀態與時限；原文法規／臨床說明的查核及正式規則。
- 月報、外部提交、billing、quality trend alerts 的範圍；原文提到不代表這些能力目前已實作。

## 7. 現有程式與未來工作的界線

目前已有 General／shift note、`riskFlags`、restrictive-practice 資料、append-only 證據及主管評估，可作為未來整合基礎；本次沒有新增表單庫、Provider 勾選設定、Extra Note 實例或跨表觸發。

後續開始實作時，先以本文件第 1 節確認方向，搭配完整原始素材設計表單 schema、觸發條件與權限，再完成第 6 節中影響該開發範圍的決策。
