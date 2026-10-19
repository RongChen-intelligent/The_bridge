const releases=[
 {version:'1.4.0',date:'2026-10-19',title:'帮助与内容管理',changes:['新增常见问答和版本更新记录。','工作人员可以删除通知、整段来信和投票活动。','来信从学生会第一次回复起保留 30 天，后续往来不延长；未回复来信不按此规则过期。','查询或复制凭证时检查来信是否仍可访问，过期或删除后显示说明。']},
 {version:'1.3.0',date:'2026-10-19',title:'图片上传与通知排版',changes:['附件改为分块上传，修复图片发布失败，增加进度提示与网络重试。','单个附件最多 10 MB，每条通知最多 8 个，合计 40 MB。','通知支持左、中、右对齐及四档字号，编辑、预览和发布保持一致。']},
 {version:'1.2.1',date:'2026-10-18',title:'来信详情修复',changes:['校验来信详情返回内容，避免点击信件后出现空白页面。','增加后台版本标识，便于检查部署是否一致。']},
 {version:'1.2.0',date:'2026-10-18',title:'校园平台界面与功能更新',changes:['依据首页参考图更新白色、蓝色的校园界面，适配手机和电脑。','完善通知附件与定时发布、同码连续往来、多选投票及截止排行。']}
];
const questions=[
 ['三个板块分别有什么用？','THE SIGNAL 查看校园通知；THE VOICE 向学生会写信并查询回复；THE COMMON GROUND 参与校园投票。'],
 ['学生需要注册账号吗？','不需要。工作人员通过独立入口登录。来信不公开，持有查询码的人可以查看同一段对话，因此请妥善保管查询码。'],
 ['来信会保留多久？','从学生会第一次回复的时间起保留 30 天，到期后无法查询或继续写信，并自动清理。之后的补充或回复不会延长期限；尚未回复的来信不会因这条规则过期。工作人员也可提前删除整段来信。'],
 ['查询码丢失或提示来信不存在怎么办？','查询码丢失后无法找回。请先核对完整查询码；信件在首次回信后超过 30 天，或被工作人员删除后，将无法查看。需要继续沟通时，请写一封新信。'],
 ['投票时可以看到票数吗？','投票进行中只能查看自己的选择；截止后可查看排行，具体票数和占比按工作人员设置显示。每次选择不得超过活动设定的数量，提交后不能修改。'],
 ['如何查看图片和 PDF？','打开通知后可查看图片，点击附件名称下载原文件。大附件需要一些加载时间；加载失败时可重试。']
];
export function HelpAndUpdates(){return <section className="site-help wrap" aria-label="帮助与更新"><div className="help-questions"><h2>常见问答</h2><p>关于使用 THE BRIDGE 的几个小问题。</p><div className="faq-list">{questions.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></div><aside className="release-notes" aria-labelledby="updates-title"><h2 id="updates-title">更新记录</h2><p>当前页面版本 <strong>1.4.0</strong></p><p className="field-note">以下日期为版本整理日期。</p>{releases.map((r,i)=><details key={r.version} open={i===0}><summary><span>v{r.version}</span><time dateTime={r.date}>{r.date}</time></summary><h3>{r.title}</h3><ul>{r.changes.map(c=><li key={c}>{c}</li>)}</ul></details>)}</aside></section>;}
