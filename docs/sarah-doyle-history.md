# Sarah Doyle：10 筆歷史班次與紀錄

這是人工撰寫的**全虛構測試資料**，供病人歷史 RAG 與 AI 追問測試使用。所有人物、事件、引言、交接與聯絡均為虛構；未發生真實照護、工作人員確認或對外聯絡。

- 個案：**Sarah Doyle (fictional demo)**，同一個案共 10 組 scheduled shift + shift note。
- Provider：TestProvider；worker：Test Support Worker。
- 期間：2026-09-01 至 2026-09-12；時區：Australia/Melbourne，這些日期為 UTC+10。
- 病人識別碼：`829d744b-71e8-4c82-9ca4-3c999004982c`。NDIS 與生日留空。
- 原始資料：[sarah-doyle-history.json](../fixtures/sarah-doyle-history.json)。下方紀錄保留英文，對應現有 app 欄位。

## 總覽

| 日期  | 預定時間    | 實際時間    | 紀錄重點                         | 新增待辦 |
| ----- | ----------- | ----------- | -------------------------------- | -------- |
| 09-01 | 10:00–14:00 | 10:00–14:00 | 圖書館、散步與自己準備午餐       | 無       |
| 09-02 | 09:30–13:00 | 09:33–13:00 | 購物、表達選擇偏好               | 無       |
| 09-03 | 10:00–14:00 | 10:00–14:00 | 咖啡店午餐較少，提出跟進         | 有       |
| 09-04 | 10:30–14:00 | 10:30–14:00 | 確認午餐環境偏好，公園用餐       | 無       |
| 09-05 | 09:30–13:00 | 09:30–13:00 | 完成生日卡與日常活動             | 無       |
| 09-07 | 10:00–14:00 | 10:00–14:00 | 步行團取消，改選其他活動         | 有       |
| 09-08 | 10:00–13:30 | 10:00–13:30 | 表示疲倦、午餐較少，交接與跟進   | 有       |
| 09-09 | 10:30–14:00 | 10:30–14:00 | 完成前一天的關懷詢問             | 無       |
| 09-10 | 09:30–13:00 | 09:30–13:08 | 購物、公園午餐與回程延誤         | 無       |
| 09-12 | 10:00–14:00 | 10:00–14:00 | 主動詢問手作團體，等待協調員回覆 | 有       |

## 閱讀與測試重點

- 9/3 的午餐較少發生在吵雜咖啡店；9/8 在家也吃得較少。不能直接推論兩次原因相同。
- 9/4 完成用餐偏好詢問；9/3 晚上的食量仍然未知，沒有補寫成已確認。
- 9/8 完成活動取消的流程跟進。再次參加步行團是 Sarah 的偏好，當時未指定訂位待辦。
- 9/9 完成前一天的關懷詢問。母親提到的晚餐與剩餘三明治屬於家屬轉述，當班午餐才是工作人員觀察。
- 最後一筆尚待協調員回覆手作團體資訊；不能寫成已訂位、已參加或已結案。
- `topics` 與 `continuity` 是編寫者提供的測試註記，不是照護人員紀錄或檢索證據。未建立逐字稿、經理審核或任何實際醫療文件。

## 本機匯入

線上狀態：2026-09-13 已匯入既有 VM，驗證 10 筆紀錄均屬同一測試個案、已標示 synthetic，且全部進入 FTS 索引。另建立當日 10:00–12:00 的空白測試班次，ID 為 `2dfe74b8-8f5e-4b62-af4b-18e46a5cb5d4`；未建立假登入、語音 session 或已完成的新 note。VM 使用獨立的 `scripts/seed-vm-patient-history.mjs` 與 當時的一次性 `prepare-vm-rag-demo.mjs`（可於 Git `c5c5021` 查閱），要求停機、正確 DB 綁定及既有測試帳號。匯入前 VM 備份保存在 `/var/lib/legalmate/backups/20260913T075952Z-rag-demo`。以下指令仍僅操作 Mac 本機資料庫。

在 `web` 目錄執行：

```sh
node --experimental-strip-types scripts/seed-patient-history.mjs --check
node --experimental-strip-types scripts/seed-patient-history.mjs --local
```

匯入工具僅支援專案的本機 D1 與現有 TestProvider 測試帳號，寫入 1 位個案、10 個班次、10 份 note。固定 ID 可防止重複匯入；已有內容不一致時會停止，不覆寫舊資料。

Notes 使用 `complete` 狀態供歷史資料測試，但 `confirmation_evidence.method` 明確記為 `synthetic_fixture`，保留實際匯入時間與模擬確認時間；不代表真實工作人員完成確認。RAG 搜尋與 AI 工具仍需另外實作。

## 虛構病人基本資料

- 生活情境：與家人同住，接受社區參與及日常生活支持。
- 虛構檔案記載：Down syndrome、Type 2 diabetes；metformin 為背景用藥資料，這 10 班沒有用藥執行紀錄。
- 溝通：可流暢口語溝通，偏好先給她時間決定。
- 目標：建立社區連結、增加身體活動、提升購物與備餐獨立性。
- 無照護計畫或 BSP 文件原檔；不因這份 fixture 推定文件存在。

## 1. 2026-09-01 — 圖書館、散步與自己準備午餐

- Shift ID：`0d95289b-2a84-4ede-ae83-3b0989efdf8c`
- Note ID：`81444f18-8989-4967-a12f-250a1d971681`
- 預定：2026-09-01 10:00–14:00；實際：2026-09-01 10:00–14:00。
- 模擬記錄時間：2026-09-01T04:12:00Z；模擬確認時間：2026-09-01T04:16:00Z。

**Activities**

Sarah chose to visit the library, followed by a walk and lunch at home. She returned two books, browsed the craft section and borrowed a card-making book. We walked from the library through the park for approximately 20 minutes, with one seated break. Sarah made a cheese and salad sandwich at home and put her library book with her craft supplies before the end of the shift.

**Support provided**

Offered two outing options and gave Sarah time to choose. Helped check the return date and provided one verbal prompt at the self-service borrowing machine. At home, Sarah chose the filling and assembled her sandwich; I helped find the chopping board and prompted her to wipe the bench afterwards.

**Participant response**

Sarah greeted the librarian and asked where the craft books were. She said she wanted to do the walk before lunch. She ate the sandwich and drank water from her bottle during the outing; the amount of water was not measured. She showed her mother the book when we returned and said she would like to go to the library again.

**Goal progress**

Sarah initiated a conversation with library staff and made her own outing and lunch choices. She completed approximately 20 minutes of walking with a rest and assembled her lunch with limited prompting.

**Incidents or concerns**

no

**Follow-up needed**

none

## 2. 2026-09-02 — 購物、表達選擇偏好

- Shift ID：`b6187950-d46c-4016-bb75-01330d3729ef`
- Note ID：`4b856048-3b83-46a8-8958-613242417715`
- 預定：2026-09-02 09:30–13:00；實際：2026-09-02 09:33–13:00。
- 模擬記錄時間：2026-09-02T03:09:00Z；模擬確認時間：2026-09-02T03:13:00Z。

**Activities**

Started at 09:33 after arriving three minutes late; apologised to Sarah and her mother. Sarah wrote a short grocery list, shopped at the local supermarket and helped prepare lunch at home. After lunch we took a 15-minute walk around the neighbourhood. All planned activities were completed within the scheduled finish time.

**Support provided**

Helped Sarah locate two items and compare package sizes. At checkout, prompted her to check the total before paying with her card. Sarah carried the lighter bag. At home I gave verbal prompts to wash the vegetables and clear the preparation area; she completed these steps herself.

**Participant response**

When I suggested another brand, Sarah said, 'Give me a minute, I want to choose.' I stepped back and she selected the items. She chatted with the checkout worker about the weather. She ate a bowl of soup and one slice of toast at lunch and suggested trying a cafe on a future outing.

**Goal progress**

Sarah selected groceries, paid by card and spoke directly with the checkout worker. She clearly communicated how she wanted support to be offered and completed a 15-minute walk.

**Incidents or concerns**

no

**Follow-up needed**

none

## 3. 2026-09-03 — 咖啡店午餐較少，提出跟進

- Shift ID：`8902b1a5-8004-4e6a-836f-a11b707059c1`
- Note ID：`2bdcde1b-0a25-42f1-b665-b823287037e0`
- 預定：2026-09-03 10:00–14:00；實際：2026-09-03 10:00–14:00。
- 模擬記錄時間：2026-09-03T04:18:00Z；模擬確認時間：2026-09-03T04:24:00Z。

**Activities**

Sarah looked at two cafes on the shopping strip and chose one for lunch. After lunch she chose to return home instead of completing the planned park walk. We spent the remaining time looking through the library craft book and selecting ideas for a birthday card for her cousin.

**Support provided**

Supported Sarah to order at the counter. When she stopped eating, asked whether she wanted anything changed and offered a quieter table. She declined the move and asked to leave. I checked whether she wanted to take the remaining sandwich home; she agreed. With Sarah's agreement, told her mother about the small amount eaten and her comments about the cafe at handover.

**Participant response**

Sarah ate approximately one quarter of her sandwich, then said, 'It's too loud in here. I want to go home.' She answered questions and chatted on the journey home. Once home, she selected two card designs and talked about which colours her cousin would like. She did not eat more during the remainder of the shift.

**Goal progress**

Sarah placed her own order and clearly expressed her wish to leave. The planned walk did not take place. She remained involved in choosing a meaningful activity at home.

**Incidents or concerns**

yes

**Incident / concern details**

Concern: Sarah ate approximately one quarter of lunch and requested to leave the busy cafe. No choking, vomiting or injury was observed. Her mother was informed at handover and the remaining sandwich was taken home. The cause of the reduced intake and what she ate after the shift are not known.

**Follow-up needed**

needed

**Follow-up details**

At the next shift, ask Sarah what lunch setting she would prefer and check how lunch went after this shift. Do not assume she wants to avoid all cafes; she referred to the noise at this venue. Mother received the handover; later intake has not yet been reported.

## 4. 2026-09-04 — 確認午餐環境偏好，公園用餐

- Shift ID：`1a2b429b-c814-4d7f-b3d8-0aff735ff70f`
- Note ID：`d9802ae6-363e-4870-99e3-bfa1b1300219`
- 預定：2026-09-04 10:30–14:00；實際：2026-09-04 10:30–14:00。
- 模擬記錄時間：2026-09-04T04:07:00Z；模擬確認時間：2026-09-04T04:12:00Z。

**Activities**

Discussed yesterday's lunch outing, then Sarah chose to pack lunch and eat at the park. She made a sandwich and packed apple slices. We stopped briefly at the library and walked for approximately 25 minutes in two sections, with a seated rest between them. Lunch was at a picnic table away from the playground.

**Support provided**

Asked Sarah what would make lunch more comfortable and offered the park or a quieter cafe. Helped pack a drink and check that the lunch container was closed. Sarah selected the table and decided when to rest. Gave one prompt to check her belongings before leaving the park.

**Participant response**

Sarah said, 'Outside is better when it's busy,' and said she might still try a quiet cafe another day. She ate the whole sandwich and some apple slices, keeping the rest for home. When asked about yesterday evening, she said she could not remember what she ate; her mother was not available to clarify. Sarah said she liked today's park lunch and wanted to return.

**Goal progress**

Sarah identified a preferred lunch environment without ruling out other options. She helped pack lunch, chose a rest break and completed approximately 25 minutes of walking.

**Incidents or concerns**

no

**Follow-up needed**

none

**Follow-up details**

Completed the 3 September check-in about lunch preferences and observed today's lunch intake. Intake after yesterday's shift remains unverified. Sarah's current preference is a quieter setting; this is a preference to check with her, not a standing restriction on cafe visits.

## 5. 2026-09-05 — 完成生日卡與日常活動

- Shift ID：`6bf05747-213b-4d4f-8a9a-92e9da9baa12`
- Note ID：`11db0292-9e3b-41c7-bf1c-0f22b6ef55ad`
- 預定：2026-09-05 09:30–13:00；實際：2026-09-05 09:30–13:00。
- 模擬記錄時間：2026-09-05T03:15:00Z；模擬確認時間：2026-09-05T03:19:00Z。

**Activities**

Sarah chose a 20-minute neighbourhood walk followed by card-making at home. She finished the birthday card she had planned on Thursday, prepared lunch and packed the craft materials away. She asked to check the time of Monday's community centre walking group before the shift ended; the published timetable listed a 10:30 start.

**Support provided**

Helped gather materials and read one step from the craft book when Sarah asked. Waited before offering help; Sarah completed the cutting and layout herself and requested help opening the glue. Provided verbal prompts during lunch preparation and checked the published group timetable with her.

**Participant response**

Sarah greeted a neighbour she knew during the walk and told them about the birthday card. She said, 'I can do this bit,' when arranging the pieces and later asked for help with the glue. She ate two small wraps for lunch and showed the finished card to her mother. She said she was looking forward to Monday's group.

**Goal progress**

Sarah completed a craft project, chose when to request support and spoke with a neighbour. She completed a 20-minute walk and expressed interest in attending a group activity.

**Incidents or concerns**

no

**Follow-up needed**

none

## 6. 2026-09-07 — 步行團取消，改選其他活動

- Shift ID：`03bf12b8-b5e4-4417-be5a-8c41a0d403f8`
- Note ID：`5c7d3625-9150-48da-9182-cd4f82994e1e`
- 預定：2026-09-07 10:00–14:00；實際：2026-09-07 10:00–14:00。
- 模擬記錄時間：2026-09-07T04:22:00Z；模擬確認時間：2026-09-07T04:28:00Z。

**Activities**

Travelled to the community centre for the 10:30 walking group. A notice at the entrance stated that the session had been cancelled because of maintenance. The centre office confirmed this by phone. After discussing alternatives, Sarah chose the library and a 15-minute park walk. She ate her packed lunch at the park before we returned home.

**Support provided**

Explained the cancellation, stayed with Sarah and gave her time before offering the library or returning home. Phoned the centre office to confirm the notice and informed the support coordinator of the disruption. Helped Sarah find a different craft book and left time for her chosen short walk.

**Participant response**

Sarah said, 'I wanted to see the group,' and was quiet for several minutes. She then chose the library and asked to borrow a book about paper flowers. She ate her packed sandwich at the park. At the end of the shift she said she still wanted to attend the walking group when it was running.

**Goal progress**

The planned group contact did not occur. Sarah chose an alternative community activity and completed a shorter walk. Her interest in the walking group remained.

**Incidents or concerns**

yes

**Incident / concern details**

Service disruption: the planned group was cancelled and this was discovered on arrival. No injury, separation or emergency occurred. The centre office confirmed the cancellation and the support coordinator was informed during the shift. Sarah was supported to choose another activity.

**Follow-up needed**

needed

**Follow-up details**

Support coordinator to confirm how staff will check group cancellations before future travel. Sarah expressed interest in another session, but did not choose a date or ask for a booking today. A future session has not been confirmed or attended.

## 7. 2026-09-08 — 表示疲倦、午餐較少，交接與跟進

- Shift ID：`77810e44-7e54-4879-ad02-8175c0ba3d9d`
- Note ID：`e196db26-e6c6-458a-9d53-7cb788dc0c59`
- 預定：2026-09-08 10:00–13:30；實際：2026-09-08 10:00–13:30。
- 模擬記錄時間：2026-09-08T03:42:00Z；模擬確認時間：2026-09-08T03:49:00Z。

**Activities**

Sarah chose a short supermarket trip close to home, lunch at home and a 10-minute walk. She helped put the groceries away and checked the receipt. We also received an update from the support coordinator about yesterday's cancelled walking group.

**Support provided**

Asked Sarah how she was feeling and adjusted the outing to her requested shorter route. Offered a rest and a drink. At lunch, asked if she wanted anything else when she stopped eating; she declined and chose to put the remaining sandwich in the fridge. With Sarah's agreement, handed over the tiredness and intake observations to her mother and support coordinator during the shift. Her mother was present at the end of the shift and agreed to check in with Sarah later.

**Participant response**

Sarah said, 'I'm tired today. Let's stay near home.' She answered questions, chose groceries and checked the receipt. She ate approximately half a sandwich and said she wanted to save the rest. Her mother reported that Sarah had eaten less dinner than usual the previous evening; I did not observe that meal. Sarah chose the short walk and then returned home.

**Goal progress**

Sarah continued to make shopping and activity choices and completed a 10-minute walk. The outing was shorter at her request. The coordinator confirmed that staff should phone the centre before future walking-group trips; this completes the cancellation-process follow-up, but does not confirm a future session.

**Incidents or concerns**

yes

**Incident / concern details**

Concern: Sarah reported feeling tired and ate approximately half her lunch. Her mother separately reported reduced dinner intake the previous evening. These observations were passed to her mother and the support coordinator. No collapse or injury was observed. No blood glucose measurement was taken by me and no cause was established.

**Follow-up needed**

needed

**Follow-up details**

Next worker to ask Sarah how she is feeling and check for updates about intake after today's shift. Record any family report separately from the worker's observations. Whether Sarah ate the saved sandwich remains unknown at handover. The walking-group cancellation-check process has been clarified. Sarah's interest in another session is recorded as an activity preference; no booking task or date has been agreed.

## 8. 2026-09-09 — 完成前一天的關懷詢問

- Shift ID：`50f1f125-6333-4e76-922c-836859449558`
- Note ID：`1cddb1b8-87ea-4b85-9220-0c79e94c3e02`
- 預定：2026-09-09 10:30–14:00；實際：2026-09-09 10:30–14:00。
- 模擬記錄時間：2026-09-09T04:11:00Z；模擬確認時間：2026-09-09T04:17:00Z。

**Activities**

Checked in about yesterday before going out. Sarah chose the library and a park walk, then lunch at home. She renewed the card-making book and helped organise her craft supplies after lunch. Walking time was approximately 25 minutes, with one seated rest.

**Support provided**

Asked Sarah how she felt and whether she wanted a short or longer route. Accepted her choice of the longer route and checked whether she wanted a break. Her mother gave an update about the previous evening. At the library Sarah used the borrowing machine herself; at home I helped locate ingredients for lunch.

**Participant response**

Sarah said, 'I'm not tired today.' Her mother reported that Sarah had eaten the saved sandwich later yesterday and had dinner; I did not observe either. During this shift I observed Sarah eat a bowl of soup and two slices of toast. She talked about the craft book while walking and asked when the centre group would next be on.

**Goal progress**

Sarah completed a longer walk than yesterday, chose when to rest and renewed her library book without a prompt at the machine. She continued to express interest in community activities.

**Incidents or concerns**

no

**Follow-up needed**

none

**Follow-up details**

Completed the 8 September check-in. Today's self-report and observed lunch intake are recorded above; the update about yesterday's later meals is a family report. No further task arose from this check-in. Sarah remains interested in the walking group, but has not selected a date or requested a booking.

## 9. 2026-09-10 — 購物、公園午餐與回程延誤

- Shift ID：`54acd31d-edcf-4892-88f8-406f63841aeb`
- Note ID：`0e9911bd-0b5b-48e5-9eea-ccf68c26f0b9`
- 預定：2026-09-10 09:30–13:00；實際：2026-09-10 09:30–13:08。
- 模擬記錄時間：2026-09-10T03:19:00Z；模擬確認時間：2026-09-10T03:23:00Z。

**Activities**

Sarah completed a grocery trip and chose to eat a packed lunch at the park. We walked for approximately 25 minutes before travelling home by bus. The return bus was delayed and the shift finished at 13:08 after groceries were put away and handover was completed, eight minutes later than planned.

**Support provided**

Gave one prompt to check the shopping list before checkout. Sarah found the items and paid independently, then requested help locating the receipt in her bag. Offered the usual short loop or an extra park loop; she chose the extra loop. Informed her mother of the bus delay and revised arrival time while we waited.

**Participant response**

Sarah spoke with the checkout worker and greeted a dog walker at the park. She ate the whole sandwich at lunch and saved the fruit for home. She said she preferred eating at the park when the weather was suitable. While waiting for the bus she asked when it would arrive and continued looking through her library book after I checked the display.

**Goal progress**

Sarah managed most shopping steps without prompts and asked for specific help when needed. She chose additional walking and had brief conversations with people in the community.

**Incidents or concerns**

no

**Follow-up needed**

none

## 10. 2026-09-12 — 主動詢問手作團體，等待協調員回覆

- Shift ID：`193fe4f3-ed4f-43d3-b9ab-0d798c26792f`
- Note ID：`f802d718-9b9c-4dab-9104-c5dcd0886766`
- 預定：2026-09-12 10:00–14:00；實際：2026-09-12 10:00–14:00。
- 模擬記錄時間：2026-09-12T04:16:00Z；模擬確認時間：2026-09-12T04:22:00Z。

**Activities**

Visited the library, where Sarah noticed a leaflet for a local craft group and asked the librarian for a copy. We took a 20-minute walk, had lunch at home and finished a second handmade card. Sarah then wrote down what she wanted to know about trying the group.

**Support provided**

Helped read the leaflet and write Sarah's questions about the session time, cost and whether materials are provided. The librarian explained that the library displays the leaflet but does not run the group. With Sarah's agreement, sent the questions to the support coordinator and asked them to check transport and support-time options before any booking.

**Participant response**

Sarah asked, 'Can I try it once before I join?' She wanted to know whether she would need to bring her own paper and glue. She ate a sandwich and yoghurt at home and remained interested in the group when we reviewed her questions at the end of the shift. She chose to keep the leaflet with her craft book.

**Goal progress**

Sarah independently identified a community activity connected to her interest in crafts. She sought information to make a choice and completed a 20-minute walk. Reading the leaflet and asking questions are preparation; she has not attended this group.

**Incidents or concerns**

no

**Follow-up needed**

needed

**Follow-up details**

Await support coordinator's response about the craft group's time, trial option, cost, materials and transport within available support hours. Check the information with Sarah before booking. No response or booking was received by the end of this shift.
