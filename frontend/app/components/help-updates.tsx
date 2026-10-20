const releases=[
 {version:'1.5.0',date:'2026-10-20',title:'更清晰的校园信息',changes:['投票页面新增手动刷新；提交选择或到达截止时间后更新结果。','倒计时持续显示，浏览投票时减少不必要的数据加载。']},
 {version:'1.4.0',date:'2026-10-19',title:'帮助与来信查询',changes:['新增常见问答和版本更新记录。','来信从学生会第一次回复起保留 30 天，后续往来不延长；未回复来信不按此规则过期。','查询或复制凭证时检查来信是否仍可访问，过期或删除后显示说明。']},
 {version:'1.3.0',date:'2026-10-19',title:'更易阅读的通知',changes:['改善通知图片与 PDF 附件的查看和下载体验。','通知正文支持多种对齐方式与字号，让活动信息更清楚。']},
 {version:'1.2.0',date:'2026-10-18',title:'校园平台体验更新',changes:['更新校园界面，适配手机和电脑。','在通知中查看附件，使用同一查询码连续来信，参与多选投票并在截止后查看排行。']}
];
const questions=[
 ['三个板块分别有什么用？','THE SIGNAL 查看校园通知；THE VOICE 向学生会写信并查询回复；THE COMMON GROUND 参与校园投票。'],
 ['学生需要注册账号吗？','不需要。工作人员通过独立入口登录。来信不公开，持有查询码的人可以查看同一段对话，因此请妥善保管查询码。'],
 ['来信会保留多久？','从学生会第一次回复的时间起保留 30 天，到期后无法查询或继续写信，并自动清理。之后的补充或回复不会延长期限；尚未回复的来信不会因这条规则过期。工作人员也可提前删除整段来信。'],
 ['查询码丢失或提示来信不存在怎么办？','查询码丢失后无法找回。请先核对完整查询码；信件在首次回信后超过 30 天，或被工作人员删除后，将无法查看。需要继续沟通时，请写一封新信。'],
 ['投票时可以看到票数吗？','投票进行中只能查看自己的选择；截止后可查看排行，具体票数和占比按工作人员设置显示。每次选择不得超过活动设定的数量，提交后不能修改。'],
 ['如何更新投票状态？','点击投票页面的“刷新投票”查看最新状态；提交选择和到达截止时间后会更新结果。倒计时在本地持续显示。'],
 ['如何查看图片和 PDF？','打开通知后可查看图片，点击附件名称下载原文件。大附件需要一些加载时间；加载失败时可重试。']
];
export function HelpAndUpdates(){return <section className="site-help wrap" aria-label="帮助与更新"><div className="help-questions"><h2>常见问答</h2><p>关于使用 THE BRIDGE 的几个小问题。</p><div className="faq-list">{questions.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></div><aside className="release-notes" aria-labelledby="updates-title"><h2 id="updates-title">更新记录</h2><p>当前页面版本 <strong>1.5.0</strong></p><p className="field-note">以下日期为版本整理日期。</p>{releases.map((r,i)=><details key={r.version} open={i===0}><summary><span>v{r.version}</span><time dateTime={r.date}>{r.date}</time></summary><h3>{r.title}</h3><ul>{r.changes.map(c=><li key={c}>{c}</li>)}</ul></details>)}</aside></section>;}
