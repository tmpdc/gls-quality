/* gls-fields.js — 通用「项目（字段）+ 下拉选项」配置引擎
 * 核心思路：表单里的每一个项目、每一个下拉选项都存在配置里，界面上可随时增/减/改，
 *          所有模块共用一套引擎，新增模块只要给一份默认配置即可，不用改框架代码。
 * 存储：localStorage  gls_fields_v1（字段配置）/ gls_dict_v1（下拉选项字典）
 * 对外：window.FIELDS，见文件末尾 API 一览
 */
(function () {
  'use strict';

  var F_KEY = 'gls_fields_v1';
  var D_KEY = 'gls_dict_v1';

  /* ==================== 下拉选项字典（全部可增删） ==================== */
  var DEFAULT_DICTS = {
    '检验类型': ['来料检验', '首件检验', '巡检', '成品检验', '出货检验'],
    '判定结果': ['合格', '不合格', '让步接收'],
    'MRB结论': ['退货', '挑选使用', '特采接收', '返工返修', '报废', '重新检验'],
    '处理方式': ['退货', '挑选使用', '特采接收', '返工返修', '报废', '重新检验', '让步放行'],
    '审核结论': ['通过', '有条件通过', '不通过'],
    '供应商类型': ['生产厂', '贸易商', '代理商'],
    '物料类别': ['原材料', '辅料', '包材', '外协件', '五金', '塑胶', '电子', '其他'],
    '供应商等级': ['A级(优选)', 'B级(合格)', 'C级(限制)'],
    '准入状态': ['合格', '待审核', '暂停', '淘汰'],
    '是否关键': ['关键件', '独家供应', '一般'],
    '资质证书': ['ISO9001', 'ISO14001', 'IATF16949', '3C', 'CE', '其他', '无'],
    '来料类型': ['客户供', '自购供应商'],
    '抽检依据': ['GB/T 2828.1-2012', 'GB/T 2829-2002', '全数检验（100%）', '客户指定标准', '企业内部检验规范', '产品图纸 / 技术协议'],
    '检验水平': ['一般检验水平 I', '一般检验水平 II', '一般检验水平 III', '特殊检验水平 S-1', '特殊检验水平 S-2', '特殊检验水平 S-3', '特殊检验水平 S-4', '全数检验'],
    '抽样方案': ['一次抽样', '二次抽样', '多次抽样', '全数检验'],
    '检验严格度': ['正常检验', '加严检验', '放宽检验'],
    'AQL': ['0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10'],
    '缺陷等级': ['致命缺陷（A类）', '严重缺陷（B类）', '轻微缺陷（C类）'],
    '不良类型': ['外观', '尺寸', '功能', '包装', '材质', '装配', '其他'],
    '严重程度': ['轻微', '一般', '严重', '致命'],
    '风险类别': ['供应风险', '质量风险', '交付风险', '成本风险', '法规风险', '安全风险'],
    '风险等级': ['低', '中', '高', '严重'],
    '风险状态': ['待处理', '监控中', '已缓解', '已关闭'],
    '培训类型': ['新员工入职', '岗位技能', '质量意识', '体系文件', '安全生产', '外部培训'],
    '考核方式': ['笔试', '实操', '口试', '不考核'],
    '文件类型': ['质量手册', '程序文件', '作业指导书', '记录表单', '外来文件', '技术图纸'],
    '文件状态': ['受控', '作废', '待审批', '试用'],
    '研发阶段': ['市场调研', '立项评审', '设计开发', '样品试制', '验证确认', '试产', '量产移交', '已关闭'],
    '评审结论': ['通过', '有条件通过', '不通过', '待补充资料'],
    '承运方式': ['快递', '物流', '自提', '送货上门'],
    '记录状态': ['待处理', '进行中', '待审批', '待评审', '已完成', '已关闭'],
    '所属类别': ['质量管理', '检验检测', '生产工艺', '体系管理', '供应链', '设备管理']
  };

  /* ==================== 各模块默认字段（首次使用时的初始配置） ==================== */
  /* type: text/textarea/number/date/select/radio/scan/readonly   dict: 下拉选项来源 */
  function F(key, label, type, opt) {
    opt = opt || {};
    return {
      key: key, label: label, type: type,
      dict: opt.dict || '',
      options: opt.options || [],
      required: !!opt.required,
      enabled: opt.enabled === false ? false : true,
      placeholder: opt.placeholder || '',
      readonly: !!opt.readonly,
      hint: opt.hint || ''
    };
  }

  var DEFAULT_FIELDS = {
    /* —— 检验工作台：新建检验单 —— */
    inspect: [
      F('type', '检验类型', 'select', { required: true, options: [['IQC', '来料检验'], ['FIRST', '首件检验'], ['PATROL', '巡检'], ['OQC', '成品检验']] }),
      F('matCode', '扫码 / 物料编码', 'scan', { required: true, placeholder: '扫码枪扫物料条码，或输入编码/名称后回车', hint: '点「带出标准」自动带出该物料的检验标准' }),
      F('matName', '物料名称', 'readonly'),
      F('supplier', '供应商', 'text', { placeholder: '来料检验必填' }),
      F('batch', '批次号', 'text', { placeholder: '如 LOT-20260929-001' }),
      F('wo', '生产工单号', 'text', { placeholder: '首件 / 巡检 / 成品检验填写' }),
      F('recvQty', '来料数量', 'number', { placeholder: '本批到货或送检总量', hint: '即送检批量 N，用于查抽样方案' }),
      F('qty', '送检数量', 'number', { placeholder: '实际送检数量' }),
      F('sampleBasis', '抽检依据', 'select', { dict: '抽检依据', hint: '默认按 GB/T 2828.1-2012；客户有指定标准时按客户标准' }),
      F('inspLevel', '检验水平', 'select', { dict: '检验水平', hint: '一般检验水平 II；破坏性 / 高成本项目用特殊检验水平 S-2、S-4' }),
      F('samplePlan', '抽样方案', 'select', { dict: '抽样方案' }),
      F('strictLevel', '检验严格度', 'select', { dict: '检验严格度' }),
      F('aql', 'AQL 值', 'select', { dict: 'AQL', hint: '致命 0.065；严重 0.65；轻微 2.5（关键安全件加严一档）' }),
      F('acRe', '判定标准 Ac/Re', 'text', { placeholder: '如 0/1', hint: '由批量 + 检验水平 + AQL 查表得出：Ac 合格判定数 / Re 不合格判定数' }),
      F('sampleQty', '抽检数量', 'number', { placeholder: '实际抽取的样本量 n' }),
      F('badQty', '不合格品数', 'number', { placeholder: '发现的不合格品数 d' }),
      F('badRate', '不合格率(%)', 'number'),
      F('defectLevel', '缺陷等级', 'select', { dict: '缺陷等级' }),
      F('tool', '测量器具', 'text', { placeholder: '如 数显卡尺 0-150 / 耐压测试仪，须在检定有效期内' }),
      F('stdVer', '标准 / 图纸版本', 'text', { placeholder: '如 A/2，须为受控最新版' }),
      F('measured', '实测记录', 'textarea', { placeholder: '逐项记录实测值 / 目视结果，可多行；尺寸项记数值不记「合格」' }),
      F('defectDesc', '不良现象描述', 'textarea', { placeholder: '不合格时的具体现象、部位、数量' }),
      F('handle', '处理方式', 'select', { dict: '处理方式' }),
      F('inspector', '检验人', 'text', { placeholder: '检验人姓名' }),
      F('date', '检验日期', 'date', { placeholder: '' }),
      F('result', '判定结果', 'radio', { options: [['pass', '合格'], ['fail', '不合格']], required: true })
    ],

    /* —— 供应商管理 —— */
    suppliers: [
      F('name', '供应商名称', 'text', { required: true }),
      F('code', '供应商编码', 'text'),
      F('material', '供应产品名称', 'text'),
      F('matSpec', '产品规格 / 型号', 'text'),
      F('matCode', '物料编码', 'text'),
      F('supType', '供应商类型', 'select', { dict: '供应商类型' }),
      F('matCls', '物料类别', 'select', { dict: '物料类别' }),
      F('cert', '资质证书', 'select', { dict: '资质证书' }),
      F('certNo', '证书编号', 'text'),
      F('certExp', '证书有效期至', 'date'),
      F('license', '营业执照号', 'text'),
      F('taxNo', '纳税人识别号', 'text'),
      F('grade', '供应商等级', 'select', { dict: '供应商等级' }),
      F('status', '准入状态', 'select', { dict: '准入状态' }),
      F('isKey', '是否关键 / 独家', 'select', { dict: '是否关键' }),
      F('inDate', '准入日期', 'date'),
      F('lastAudit', '最近审核日期', 'date'),
      F('auditResult', '审核结论', 'select', { dict: '审核结论' }),
      F('passRate', '来料合格率(%)', 'number'),
      F('onTimeRate', '准时交付率(%)', 'number'),
      F('score', '供应商评分', 'number'),
      F('contact', '联系人', 'text'),
      F('phone', '电话', 'text'),
      F('addr', '地址', 'text'),
      F('payTerm', '账期', 'text', { placeholder: '如 月结30天' }),
      F('desc', '备注', 'textarea')
    ],

    /* —— 到货检验 —— */
    incoming: [
      F('name', '物料名称', 'text', { required: true }),
      F('supplier', '供应商', 'text'),
      F('spec', '规格型号', 'text'),
      F('batch', '批号', 'text'),
      F('qty', '送检数量', 'number'),
      F('recvQty', '来料数量', 'number'),
      F('sampleBasis', '抽检依据', 'select', { dict: '抽检依据' }),
      F('inspLevel', '检验水平', 'select', { dict: '检验水平' }),
      F('aql', 'AQL 值', 'select', { dict: 'AQL' }),
      F('acRe', '判定标准 Ac/Re', 'text', { placeholder: '如 0/1' }),
      F('sampleQty', '抽样数', 'number'),
      F('result', '判定', 'select', { dict: '判定结果' }),
      F('badQty', '不良数量', 'number'),
      F('badRate', '不良率(%)', 'number'),
      F('handle', '处理方式', 'select', { dict: '处理方式' }),
      F('inspector', '检验员', 'text'),
      F('date', '检验日期', 'date'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 研发管理 —— */
    rd: [
      F('name', '项目名称', 'text', { required: true }),
      F('code', '项目编号', 'text'),
      F('stage', '研发阶段', 'select', { dict: '研发阶段' }),
      F('source', '客户 / 市场来源', 'text'),
      F('owner', '负责人', 'text'),
      F('startDate', '立项日期', 'date'),
      F('input', '设计输入', 'textarea'),
      F('output', '设计输出', 'textarea'),
      F('verify', '验证方式', 'textarea'),
      F('reviewResult', '评审结论', 'select', { dict: '评审结论' }),
      F('endDate', '完成日期', 'date'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 生产过程 —— */
    production: [
      F('name', '工单号 / 产品', 'text', { required: true }),
      F('product', '产品名称', 'text'),
      F('batch', '生产批次', 'text'),
      F('firstResult', '首件判定', 'select', { dict: '判定结果' }),
      F('patrolTime', '巡检时间', 'text', { placeholder: '如 08:00 / 10:00' }),
      F('process', '工序', 'text'),
      F('sampleBasis', '抽检依据', 'select', { dict: '抽检依据' }),
      F('sampleQty', '抽检数', 'number'),
      F('badQty', '不良数', 'number'),
      F('badType', '不良类型', 'select', { dict: '不良类型' }),
      F('defectLevel', '缺陷等级', 'select', { dict: '缺陷等级' }),
      F('handle', '处理方式', 'select', { dict: '处理方式' }),
      F('inspector', '巡检员', 'text'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 成品检验 —— */
    inspection: [
      F('name', '工单号 / 产品', 'text', { required: true }),
      F('product', '产品名称', 'text'),
      F('model', '型号', 'text'),
      F('batchQty', '批量', 'number'),
      F('batch', '生产批次', 'text'),
      F('sampleBasis', '抽检依据', 'select', { dict: '抽检依据' }),
      F('inspLevel', '检验水平', 'select', { dict: '检验水平' }),
      F('sampleQty', '抽样数', 'number'),
      F('aql', 'AQL 值', 'select', { dict: 'AQL', hint: '致命 0.065 / 严重 0.65 / 轻微 2.5' }),
      F('acRe', '判定标准 Ac/Re', 'text', { placeholder: '如 0/1' }),
      F('defectLevel', '缺陷等级', 'select', { dict: '缺陷等级' }),
      F('handle', '处理方式', 'select', { dict: '处理方式' }),
      F('items', '检验项目', 'textarea'),
      F('result', '判定', 'select', { dict: '判定结果' }),
      F('badQty', '不良数', 'number'),
      F('badRate', '不良率(%)', 'number'),
      F('inspector', '检验员', 'text'),
      F('inQty', '入库数量', 'number'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 出货管理 —— */
    shipping: [
      F('name', '出货单号', 'text', { required: true }),
      F('customer', '客户', 'text'),
      F('product', '产品名称', 'text'),
      F('qty', '数量', 'number'),
      F('sampleQty', '抽检数量', 'number'),
      F('sampleBasis', '抽检依据', 'select', { dict: '抽检依据' }),
      F('aql', 'AQL 值', 'select', { dict: 'AQL' }),
      F('date', '出货日期', 'date'),
      F('result', '检验判定', 'select', { dict: '判定结果' }),
      F('docs', '随货文件', 'textarea'),
      F('carrier', '承运方式', 'select', { dict: '承运方式' }),
      F('addr', '收货地址', 'text'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 异常处理 —— */
    abnormal: [
      F('name', '异常编号 / 主题', 'text', { required: true }),
      F('date', '发生日期', 'date'),
      F('dept', '发现部门', 'text'),
      F('badType', '不良类型', 'select', { dict: '不良类型' }),
      F('level', '严重程度', 'select', { dict: '严重程度' }),
      F('badQty', '不良数量', 'number'),
      F('detail', '不良描述', 'textarea'),
      F('dutyDept', '责任部门', 'text'),
      F('cause', '原因分析', 'textarea'),
      F('corrective', '纠正措施', 'textarea'),
      F('preventive', '预防措施', 'textarea'),
      F('conclusion', '处理结论', 'select', { dict: '处理方式' })
    ],

    /* —— 风险预警 —— */
    risk: [
      F('name', '风险编号 / 主题', 'text', { required: true }),
      F('date', '识别日期', 'date'),
      F('category', '风险类别', 'select', { dict: '风险类别' }),
      F('detail', '风险描述', 'textarea'),
      F('level', '风险等级', 'select', { dict: '风险等级' }),
      F('impact', '可能影响', 'textarea'),
      F('preventive', '预防措施', 'textarea'),
      F('owner', '责任人', 'text'),
      F('closeDate', '关闭日期', 'date'),
      F('status', '状态', 'select', { dict: '风险状态' })
    ],

    /* —— 体系文件 —— */
    documents: [
      F('name', '文件名称', 'text', { required: true }),
      F('code', '文件编号', 'text'),
      F('docType', '文件类型', 'select', { dict: '文件类型' }),
      F('ver', '版本号', 'text'),
      F('effDate', '生效日期', 'date'),
      F('revDate', '修订日期', 'date'),
      F('writer', '编制人', 'text'),
      F('reviewer', '审核人', 'text'),
      F('approver', '批准人', 'text'),
      F('status', '状态', 'select', { dict: '文件状态' }),
      F('location', '存放位置', 'text'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 知识查询 —— */
    knowledge: [
      F('name', '知识点名称', 'text', { required: true }),
      F('category', '所属类别', 'select', { dict: '所属类别' }),
      F('keywords', '关键词', 'text'),
      F('source', '来源标准 / 依据', 'text'),
      F('dept', '适用部门', 'text'),
      F('summary', '内容摘要', 'textarea')
    ],

    /* —— 培训管理 —— */
    training: [
      F('name', '培训主题', 'text', { required: true }),
      F('trainType', '培训类型', 'select', { dict: '培训类型' }),
      F('date', '培训日期', 'date'),
      F('teacher', '讲师', 'text'),
      F('dept', '参训部门', 'text'),
      F('members', '参训人员', 'textarea'),
      F('hours', '课时', 'number'),
      F('examWay', '考核方式', 'select', { dict: '考核方式' }),
      F('examResult', '考核结果', 'text'),
      F('material', '培训资料', 'textarea')
    ]
  };

  /* 通用内容块：每个模块都带，同样可以增删改（与业务字段同等对待） */
  var HTML_BLOCK = [
    F('process', '流程步骤', 'html', { hint: '过程流程图、作业步骤、节点说明，支持HTML表格和列表', placeholder: '输入流程步骤，可用HTML标签，如：<ol><li>步骤1</li></ol>' }),
    F('recordTemplate', '记录模板', 'html', { hint: '记录表单、检验报告、审批表等，带格式的模板', placeholder: '输入记录模板，可用HTML表格，如：<table><tr><td>项目</td><td>标准</td><td>实测</td></tr></table>' }),
    F('template', '模板', 'html', { hint: '标准模板、表单格式、检验项目等', placeholder: '输入模板内容，可包含表格、步骤等' }),
    F('knowledge', '知识点', 'html', { hint: '标准依据、理论知识、关键参数等', placeholder: '输入相关知识点' }),
    F('logic', '底层逻辑', 'html', { hint: '为什么这么做、原理机制、因果关系等', placeholder: '输入底层逻辑分析' }),
    F('operation', '操作步骤', 'html', { hint: '具体操作步骤、执行方法、注意事项等', placeholder: '输入具体操作步骤' }),
    F('implementation', '落实情况', 'html', { hint: '任务分解、责任人、完成时间、完成状态跟踪表', placeholder: '输入落实情况跟踪表，可用HTML表格' })
  ];

  /* 合并：每个业务模块都补上「名称 / 描述 / 状态 + 6 个内容块」，保证可增删 */
  Object.keys(DEFAULT_FIELDS).forEach(function (m) {
    if (m === 'inspect') return;
    var list = DEFAULT_FIELDS[m];
    var has = function (k) { return list.some(function (x) { return x.key === k; }); };
    if (!has('name')) list.unshift(F('name', '名称', 'text', { required: true }));
    if (!has('description')) list.splice(1, 0, F('description', '描述', 'text', { placeholder: '简要描述' }));
    if (!has('status')) list.splice(2, 0, F('status', '状态', 'select', { dict: '记录状态' }));
    HTML_BLOCK.forEach(function (b) {
      if (!has(b.key)) list.push(Object.assign({}, b));
    });
  });

  /* 模块名（用于设计器标题） */
  var MODULE_NAMES = {
    inspect: '检验工作台 · 检验单',
    suppliers: '供应商管理', incoming: '到货检验', rd: '研发管理', production: '生产过程',
    inspection: '成品检验', shipping: '出货管理', abnormal: '异常处理', risk: '风险预警',
    documents: '体系文件', knowledge: '知识查询', training: '培训管理'
  };

  /* ==================== 存储 ==================== */
  function lsGet(key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function allFields() {
    var o = lsGet(F_KEY, null);
    return (o && typeof o === 'object') ? o : {};
  }
  function cloneField(f) { return Object.assign({}, f); }

  /* 取某模块字段清单：用户改过的配置优先；默认配置里「新加、而用户配置里没有」的字段
     会自动并入；用户主动删掉的字段（记在 __removed__）不会被补回来。 */
  function get(moduleId) {
    var def = (DEFAULT_FIELDS[moduleId] || []).map(cloneField);
    var o = allFields();
    if (!Array.isArray(o[moduleId])) return def;
    var list = o[moduleId].map(cloneField);
    var has = {};
    list.forEach(function (f) { has[f.key] = 1; });
    var gone = (o.__removed__ && o.__removed__[moduleId]) || [];
    def.forEach(function (f) {
      if (has[f.key]) return;
      if (gone.indexOf(f.key) >= 0) return;
      list.push(f);
    });
    return list;
  }
  function save(moduleId, arr) {
    var o = allFields();
    o[moduleId] = arr;
    var now = {};
    arr.forEach(function (f) { now[f.key] = 1; });
    var rm = o.__removed__ || {};
    rm[moduleId] = (DEFAULT_FIELDS[moduleId] || [])
      .map(function (f) { return f.key; })
      .filter(function (k) { return !now[k]; });
    o.__removed__ = rm;
    lsSet(F_KEY, o);
  }
  function reset(moduleId) {
    var o = allFields();
    delete o[moduleId];
    if (o.__removed__) delete o.__removed__[moduleId];
    lsSet(F_KEY, o);
  }
  function isCustom(moduleId) {
    return Array.isArray(allFields()[moduleId]);
  }
  function moduleIds() {
    var ids = Object.keys(DEFAULT_FIELDS);
    Object.keys(allFields()).forEach(function (k) {
      if (k.indexOf('__') === 0) return;
      if (ids.indexOf(k) < 0) ids.push(k);
    });
    return ids;
  }

  /* ---------- 字典 ---------- */
  function allDicts() {
    var o = lsGet(D_KEY, null);
    var base = {};
    Object.keys(DEFAULT_DICTS).forEach(function (k) { base[k] = DEFAULT_DICTS[k].slice(); });
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) { base[k] = Array.isArray(o[k]) ? o[k].slice() : base[k]; });
    }
    return base;
  }
  function dict(name) { return allDicts()[name] || []; }
  function setDict(name, arr) {
    var o = lsGet(D_KEY, {}) || {};
    o[name] = arr;
    lsSet(D_KEY, o);
  }
  function delDict(name) {
    var o = lsGet(D_KEY, {}) || {};
    delete o[name];
    lsSet(D_KEY, o);
    // 清掉字段上对已删字典的引用
    var f = allFields();
    var changed = false;
    Object.keys(f).forEach(function (m) {
      f[m].forEach(function (x) { if (x.dict === name) { x.dict = ''; changed = true; } });
    });
    if (changed) lsSet(F_KEY, f);
  }
  function renameDict(oldName, newName) {
    if (!newName || oldName === newName) return;
    var o = lsGet(D_KEY, {}) || {};
    if (o[oldName]) { o[newName] = o[oldName]; delete o[oldName]; }
    else { o[newName] = (DEFAULT_DICTS[oldName] || []).slice(); }
    lsSet(D_KEY, o);
    var f = allFields();
    Object.keys(f).forEach(function (m) {
      f[m].forEach(function (x) { if (x.dict === oldName) x.dict = newName; });
    });
    lsSet(F_KEY, f);
  }

  /* ---------- 字段取值（下拉选项） ---------- */
  function optionsOf(field) {
    if (field.options && field.options.length) {
      // radio 形式 [[val,label],...] 或 select 形式 ['a','b']
      return field.options.map(function (o) {
        return Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: o };
      });
    }
    if (field.dict) return dict(field.dict).map(function (o) { return { value: o, label: o }; });
    return [];
  }

  /* ==================== 渲染 ==================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fieldHtml(moduleId, f, values) {
    var v = values && values[f.key] != null ? values[f.key] : '';
    var id = 'fx_' + moduleId + '_' + f.key;
    var req = f.required ? ' <span class="fx-req">*</span>' : '';
    var h = '<div class="fx-row" data-key="' + esc(f.key) + '"><label for="' + id + '">' + esc(f.label) + req + '</label>';

    if (f.type === 'textarea') {
      h += '<textarea id="' + id + '" placeholder="' + esc(f.placeholder) + '">' + esc(v) + '</textarea>';
    } else if (f.type === 'select') {
      var opts = optionsOf(f);
      h += '<select id="' + id + '"><option value="">请选择</option>';
      opts.forEach(function (o) {
        h += '<option value="' + esc(o.value) + '"' + (String(v) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      });
      h += '</select>';
    } else if (f.type === 'radio') {
      var ropts = optionsOf(f);
      h += '<div class="fx-radio" id="' + id + '">';
      ropts.forEach(function (o, i) {
        h += '<label><input type="radio" name="' + id + '" value="' + esc(o.value) + '"'
          + (String(v) === String(o.value) ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
      });
      h += '</div>';
    } else if (f.type === 'html') {
      h += '<div class="fx-htmlwrap">'
        + '<div class="fx-htmlbar">'
        + '<button type="button" class="fx-btn fx-btn-g" onclick="if(window.openImportPicker)openImportPicker(\'' + esc(f.key) + '\', true)">📥 导入</button>'
        + '<button type="button" class="fx-btn" onclick="var t=document.getElementById(\'' + id + '\');if(t)t.value=\'\'">清空</button>'
        + '</div>'
        + '<textarea id="' + id + '" style="min-height:118px" placeholder="' + esc(f.placeholder) + '">' + esc(v) + '</textarea>'
        + '</div>';
    } else if (f.type === 'scan') {
      h += '<div class="fx-scan"><input id="' + id + '" placeholder="' + esc(f.placeholder) + '"'
        + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();if(window.INSP&&INSP.scanMaterial)INSP.scanMaterial();}">'
        + '<button type="button" class="fx-btn fx-btn-g" onclick="if(window.INSP&&INSP.scanMaterial)INSP.scanMaterial()">带出标准</button></div>';
    } else {
      var t = (f.type === 'number') ? 'number' : (f.type === 'date' ? 'date' : 'text');
      h += '<input id="' + id + '" type="' + t + '" value="' + esc(v) + '" placeholder="' + esc(f.placeholder) + '"'
        + (f.readonly || f.type === 'readonly' ? ' readonly' : '') + '>';
    }
    if (f.hint) h += '<div class="fx-hint">' + esc(f.hint) + '</div>';
    h += '</div>';
    return h;
  }

  /* 渲染整个表单区（values 用于编辑回填） */
  function render(moduleId, values, opts) {
    opts = opts || {};
    var list = get(moduleId).filter(function (f) { return f.enabled !== false; });
    var h = '<div class="fx-form" data-module="' + esc(moduleId) + '">';
    list.forEach(function (f) { h += fieldHtml(moduleId, f, values); });
    h += '</div>';
    if (opts.withToolbar !== false) {
      h += '<div class="fx-toolbar"><span class="fx-tip">项目可自行增删：点右侧「⚙ 配置项目」</span>'
        + '<button type="button" class="fx-btn" onclick="FIELDS.openDesigner(\'' + moduleId + '\')">⚙ 配置项目</button></div>';
    }
    return h;
  }

  /* 收集表单值 */
  function collect(moduleId, root) {
    var scope = root || document;
    var list = get(moduleId).filter(function (f) { return f.enabled !== false; });
    var out = {};
    list.forEach(function (f) {
      /* 单选组：多个 radio 不能共用一个 id，必须按 name 取值。
         （原来这步排在 id 查找之后，radio 因找不到 id 被直接 return 掉，
           导致「判定结果」这类字段永远收集不到、单据提交不了。） */
      if (f.type === 'radio') {
        var c = scope.querySelector('input[name="fx_' + moduleId + '_' + f.key + '"]:checked');
        out[f.key] = c ? c.value : '';
        return;
      }
      if (f.type === 'html') return;
      var el = scope.querySelector('#fx_' + moduleId + '_' + f.key);
      if (!el) return;
      out[f.key] = el.value;
    });
    return out;
  }

  /* 必填校验 */
  function validate(moduleId, data) {
    var list = get(moduleId).filter(function (f) { return f.enabled !== false; });
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.required && !String(data[f.key] || '').trim()) return { ok: false, msg: '请填写「' + f.label + '」' };
    }
    return { ok: true, msg: '' };
  }

  /* ==================== 载入时注入样式 ==================== */
  var CSS = [
    '.fx-form{display:block}',
    '.fx-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;flex-wrap:wrap}',
    '.fx-row>label{min-width:132px;max-width:132px;text-align:right;padding-top:9px;color:#374151;font-size:14px;line-height:1.3}',
    '.fx-req{color:#dc2626}',
    '.fx-row>input,.fx-row>select,.fx-row>textarea,.fx-row>.fx-scan,.fx-row>.fx-radio{flex:1;min-width:0}',
    '.fx-row input[type=text],.fx-row input[type=number],.fx-row input[type=date],.fx-row select,.fx-row textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font-size:14px;background:#fff;color:#111827;font-family:inherit}',
    '.fx-row input[readonly]{background:#f3f4f6;color:#6b7280}',
    '.fx-row textarea{min-height:82px;resize:vertical}',
    '.fx-hint{flex-basis:100%;margin-left:142px;color:#9ca3af;font-size:12px}',
    '.fx-scan{display:flex;gap:8px}',
    '.fx-scan>input{flex:1}',
    '.fx-htmlwrap{flex:1;min-width:0}',
    '.fx-htmlbar{display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap}',
    '.fx-radio{display:flex;gap:10px;flex-wrap:wrap}',
    '.fx-radio>label{display:flex;align-items:center;gap:6px;border:1px solid #d1d5db;border-radius:7px;padding:9px 18px;cursor:pointer;background:#fff;font-size:14px;flex:1;justify-content:center}',
    '.fx-radio>label:has(input:checked){border-color:#2d7a4f;background:#eef7f1;color:#2d7a4f;font-weight:600}',
    '.fx-btn{padding:8px 14px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:7px;cursor:pointer;font-size:13px}',
    '.fx-btn-g{background:#eef7f1;border-color:#2d7a4f;color:#2d7a4f}',
    '.fx-btn-p{background:#2d7a4f;border-color:#2d7a4f;color:#fff}',
    '.fx-btn-d{background:#fff;border-color:#e5a5a5;color:#dc2626}',
    '.fx-toolbar{margin:10px 0 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}',
    '.fx-tip{color:#9ca3af;font-size:12px;margin-right:auto}',
    '@media(max-width:768px){.fx-row>label{min-width:100%;max-width:100%;text-align:left;padding-top:0}.fx-hint{margin-left:0}}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('fxStyle')) return;
    var s = document.createElement('style');
    s.id = 'fxStyle';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCss);
  } else { injectCss(); }

  window.FIELDS = {
    /* 数据 */
    get: get, save: save, reset: reset, isCustom: isCustom, moduleIds: moduleIds,
    moduleName: function (id) { return MODULE_NAMES[id] || id; },
    defaults: function (id) { return (DEFAULT_FIELDS[id] || []).map(function (f) { return Object.assign({}, f); }); },
    /* 字典 */
    dicts: allDicts, dict: dict, setDict: setDict, delDict: delDict, renameDict: renameDict,
    /* 渲染与读写 */
    render: render, collect: collect, validate: validate, optionsOf: optionsOf, esc: esc,
    /* 界面（在 gls-fields-ui.js 中实现，挂载到此处） */
    openDesigner: function (id) { alert('配置界面未加载'); }
  };
})();
