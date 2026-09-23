function evaluationPage(){
  const report=app.state.evaluation;
  const ready=report&&typeof report.end_to_end_accuracy==='number';
  const usage=app.state.model_usage||[];
  const reported=usage.filter(row=>Number.isInteger(row.total_tokens));
  const sum=key=>reported.reduce((total,row)=>total+(Number.isInteger(row[key])?row[key]:0),0);
  const percent=value=>`${(Number(value||0)*100).toFixed(1)}%`;
  const metric=(label,value,detail,tone='')=>`<div class="stat eval-metric ${tone}"><div class="stat-label">${label}</div><div class="metric-big">${value}</div><div class="metric-caption">${detail}</div></div>`;
  const usageValue=reported.length?`${sum('total_tokens').toLocaleString()} Token`:'暂无数据';
  return `<div class="page-head"><div><span class="eyebrow">QUALITY EVALUATION</span><h1>效果评测</h1><p>同一套标注数据反复运行，检查条款、证据、状态和草稿保护。</p></div><button class="button primary" id="run-eval">▶ 运行评测</button></div>
    ${ready?`<div class="eval-scope"><strong>${esc(report.mode)}</strong><span>${report.project_count} 份文件 · ${report.gold_count} 条人工标注要求 · ${esc(report.run_at)}</span><span>运行耗时 ${report.elapsed_ms} ms</span></div>
    <div class="evaluation-grid eval-primary-grid">
      ${metric('端到端正确响应率',percent(report.end_to_end_accuracy),`${report.end_to_end_correct_count} / ${report.gold_count} 条：提取、首要证据、状态与草稿保护全部通过`,'featured')}
      ${metric('错误判为有依据',percent(report.false_supported_rate),`${report.false_supported_count} / ${report.predicted_supported_count} 条被判“有依据”的要求实际证据不足`,'risk')}
      ${metric('首要证据准确率',percent(report.evidence_top1_accuracy),`${report.evidence_correct_count} / ${report.evidence_evaluated_count} 条：首条材料与人工标注一致`)}
    </div>
    <div class="evaluation-grid">
      ${metric('要求召回率',percent(report.requirement_recall),`${report.matched_count} / ${report.gold_count} 条要求被找到`)}
      ${metric('要求精确率',percent(report.requirement_precision),`${report.matched_count} / ${report.extracted_count} 条提取结果属于标注要求`)}
      ${metric('状态判断准确率',percent(report.status_accuracy),`${report.correct_status_count} / ${report.matched_count} 条已提取要求状态正确`)}
    </div>
    <div class="eval-note">端到端指标包含遗漏要求；草稿保护只检查模板是否保留依据或风险标记，不能替代人工事实核验。内置评测使用离线规则，不调用模型。</div>
    <div class="two-col eval-detail-grid"><section class="card"><div class="card-head"><h3>分组表现</h3><small>基线 / 场景 / 挑战</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>测试组</th><th>要求</th><th>已提取</th><th>端到端通过</th><th>错误有依据</th></tr></thead><tbody>${report.splits.map(row=>`<tr><td><strong>${esc(row.name)}</strong></td><td>${row.gold}</td><td>${row.found}</td><td>${row.end_to_end_correct}</td><td>${row.false_supported}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><div class="card-head"><h3>问题分布</h3><small>${report.error_count} 项</small></div><div class="error-list">${report.errors.slice(0,7).map(row=>`<div class="error-row"><span class="error-marker ${row.type==='错误判为有依据'?'critical':''}"></span><div><strong>${esc(row.type)} · ${esc(row.needle)}</strong><p>${esc(row.detail)}</p></div></div>`).join('')}</div></section></div>
    <details class="card eval-all-errors"><summary>查看全部 ${report.error_count} 项问题</summary><div class="error-list">${report.errors.map(row=>`<div class="error-row"><span class="error-marker ${row.type==='错误判为有依据'?'critical':''}"></span><div><strong>${esc(row.type)} · ${esc(row.needle)}</strong><p>${esc(row.file)} · ${esc(row.detail)}</p></div></div>`).join('')}</div></details>
    <section class="card eval-files"><div class="card-head"><h3>逐文件结果</h3><small>${report.projects.length} 份</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>测试文件</th><th>分组</th><th>标注要求</th><th>提取</th><th>状态正确</th><th>端到端通过</th></tr></thead><tbody>${report.projects.map(row=>`<tr><td><strong>${esc(row.file.split('/').pop())}</strong></td><td>${esc(row.split)}</td><td>${row.gold}</td><td>${row.found}</td><td>${row.status_correct}</td><td>${row.end_to_end_correct}</td></tr>`).join('')}</tbody></table></div></section>`:`<section class="card"><div class="empty">点击「运行评测」，生成扩展测试集的质量报告。</div></section>`}
    <section class="card eval-usage"><div class="card-head"><div><h3>模型 Token 用量</h3><small>仅统计模型服务商实际返回的 usage</small></div><span class="tag">${usage.length} 次调用记录</span></div><div class="card-body"><div class="usage-grid"><div><small>已报告总量</small><strong>${usageValue}</strong></div><div><small>输入 Token</small><strong>${reported.length?sum('prompt_tokens').toLocaleString():'—'}</strong></div><div><small>输出 Token</small><strong>${reported.length?sum('completion_tokens').toLocaleString():'—'}</strong></div><div><small>返回用量的调用</small><strong>${reported.length} / ${usage.length}</strong></div></div><p class="usage-caption">从启用记录后开始累计；之前的调用无法补记。当前固定评测本身消耗 0 Token。</p></div>
    ${usage.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>操作</th><th>模型</th><th>输入</th><th>输出</th><th>合计</th><th>耗时</th></tr></thead><tbody>${usage.slice(-10).reverse().map(row=>`<tr><td>${esc(row.at)}</td><td>${esc(row.operation||'模型调用')}</td><td>${esc(row.model)}</td><td>${row.prompt_tokens??'—'}</td><td>${row.completion_tokens??'—'}</td><td>${row.total_tokens??'未返回'}</td><td>${row.latency_ms} ms</td></tr>`).join('')}</tbody></table></div>`:''}</section>`;
}
