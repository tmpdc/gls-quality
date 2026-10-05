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
    '所属类别': ['质量管理', '检验检测', '生产工艺', '体系管理', '供应链', '设备管理'],
    /* —— ERP 业务用 —— */
    '人员': [],
    '库位': [],
    '单位': ['PCS', '个', '只', '套', '台', '件', '箱', '包', '卷', '米', '千克', '克', '升', '毫升', '张', '对', '付', '桶', '瓶'],
    '部门': ['管理层', '品质部', '生产部', '仓储部', '技术部', '采购部', '业务部', '财务部', '人事行政部'],
    '生产线别': ['一号线', '二号线', '三号线', '四号线', '五号线', '装配线', '包装线'],
    '退货原因': ['外观不良', '功能故障', '尺寸超差', '包装破损', '错发漏发', '客户改单', '质量问题', '其他'],
    '产品': ['G-C400S1 破壁机', 'G-K300 烧水杯', 'G-K500 电热水壶', 'G-B200 保温杯'],
    '物料分类': ['原材料', '半成品', '成品', '包材', '辅料', '五金件', '塑胶件', '电子件', '外协件'],
    '仓库类型': ['原材料仓', '半成品仓', '成品仓', '售后仓', '辅料仓', '不良品仓'],
    '收款方式': ['电汇', '承兑汇票', '现金', '月结30天', '月结60天', '货到付款'],
    '运输方式': ['快递', '物流', '自提', '送货上门', '专车'],
    '工单状态': ['待排产', '已排产', '生产中', '暂停', '已完工', '已关闭'],
    '优先级': ['普通', '紧急', '特急'],
    /* —— 计量器具 / 标准图纸（可在「下拉选项管理」里增删） —— */
    '量具': ['数显卡尺 0-150mm', '数显千分尺 0-25mm', '钢卷尺 3m', '直尺', '塞尺', '螺纹规', '半径规',
             '耐压测试仪', '绝缘电阻测试仪', '接地电阻测试仪', '泄漏电流测试仪', '功率计', '万用表',
             '恒温水浴锅', '温度记录仪', '红外测温仪', '推拉力计', '扭矩测试仪', '硬度计',
             '盐雾试验箱', '灼热丝试验仪', '标准砝码', '色差仪', '光泽度计'],
    '标准图纸': [],
    '校准方式': ['检定', '校准', '内部比对', '免校（一次性使用）'],
    '检定结论': ['合格', '限用', '停用', '报废'],
    '设备状态': ['在用', '封存', '维修中', '停用', '报废']
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
      hint: opt.hint || '',
      calc: opt.calc || '',
      decimals: (opt.decimals == null ? 2 : opt.decimals),
      from: opt.from || '',
      tpl: opt.tpl || ''
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
      F('aql', 'AQL 值', 'multiselect', { dict: 'AQL', hint: '致命 0.065；严重 0.65；轻微 2.5（关键安全件加严一档）；每一档都选一个' }),
      F('acRe', '判定标准 Ac/Re', 'text', { placeholder: '如 0/1', hint: '由批量 + 检验水平 + AQL 查表得出：Ac 合格判定数 / Re 不合格判定数' }),
      F('sampleQty', '抽检数量', 'number', { placeholder: '实际抽取的样本量 n' }),
      F('badQty', '不合格品数', 'number'),
      F('badRate', '不合格率(%)', 'number', { calc: 'badQty/sampleQty*100', decimals: 2, readonly: true, hint: '自动计算 = 不合格品数 ÷ 抽检数量 × 100' }),
      F('defectLevel', '缺陷等级', 'select', { dict: '缺陷等级' }),
      F('tool', '测量器具', 'multiselect', { dict: '量具', from: 'erp:equip.name', placeholder: '从「检测设备一览表」里选，可多选', hint: '来源：ERP「检测设备一览表」——台账里新增设备后，这里自动出现；须在检定有效期内' }),
      F('stdVer', '标准 / 图纸版本', 'multiselect', { dict: '标准图纸', from: 'pqs:doc', tpl: '{code} {name}（{ver}）', placeholder: '从品质资料库「受控文件」里选，可多选', hint: '来源：品质资料库 →「受控文件」——选择后为受控最新版；图纸请先在受控文件里登记' }),
      F('measured', '实测记录', 'textarea', { placeholder: '逐项记录实测值 / 目视结果，可多行；尺寸项记数值不记「合格」' }),
      F('defectDesc', '不良现象描述', 'textarea', { placeholder: '不合格时的具体现象、部位、数量' }),
      F('handle', '处理方式', 'select', { dict: '处理方式' }),
      F('inspector', '检验人', 'select', { dict: '人员', from: 'user:IQC,IPQC,OQC,检验,测试,品质', hint: '下拉来自账号的「岗位 / 职责」，如 来料检验员IQC / 巡检IPQC / 成品检验员OQC；账号里没填岗位的也会列出来兜底' }),
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
      F('badRate', '不良率(%)', 'number', { calc: 'badQty/sampleQty*100', decimals: 2, readonly: true, hint: '自动计算 = 不良数量 ÷ 抽样数 × 100' }),
      F('handle', '处理方式', 'select', { dict: '处理方式' }),
      F('inspector', '检验员', 'select', { dict: '人员', from: 'user:IQC,IPQC,OQC,检验,测试,品质', hint: '下拉来自账号的「岗位 / 职责」' }),
      F('date', '检验日期', 'date'),
      F('desc', '备注', 'textarea')
    ],

    /* —— 研发管理 —— */
    rd: [
      F('name', '项目名称', 'text', { required: true }),
      F('code', '项目编号', 'text'),
      F('stage', '研发阶段', 'select', { dict: '研发阶段' }),
      F('source', '客户 / 市场来源', 'text'),
      F('owner', '负责人', 'select', { dict: '人员', from: 'user:', hint: '下拉来自账号列表（全部在用账号）' }),
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
      F('inspector', '巡检员', 'select', { dict: '人员', from: 'user:IPQC,巡检,IQC,OQC,检验,测试,品质', hint: '下拉来自账号的「岗位 / 职责」，巡检IPQC 会自动出现' }),
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
      F('badRate', '不良率(%)', 'number', { calc: 'badQty/sampleQty*100', decimals: 2, readonly: true, hint: '自动计算 = 不良数 ÷ 抽样数 × 100' }),
      F('inspector', '检验员', 'select', { dict: '人员', from: 'user:IQC,IPQC,OQC,检验,测试,品质', hint: '下拉来自账号的「岗位 / 职责」' }),
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
      F('owner', '责任人', 'select', { dict: '人员', from: 'user:', hint: '下拉来自账号列表（全部在用账号）' }),
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
      F('writer', '编制人', 'select', { dict: '人员', from: 'user:', hint: '下拉来自账号列表（全部在用账号）' }),
      F('reviewer', '审核人', 'select', { dict: '人员', from: 'user:', hint: '下拉来自账号列表（全部在用账号）' }),
      F('approver', '批准人', 'select', { dict: '人员', from: 'user:', hint: '下拉来自账号列表（全部在用账号）' }),
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
    /* 老配置里没有「自动计算」这类系统能力键，从默认配置补齐，避免升级后失效 */
    var _defMap = {};
    def.forEach(function (f) { _defMap[f.key] = f; });
    list.forEach(function (f) {
      var d = _defMap[f.key];
      if (!d) return;
      ['calc', 'decimals', 'from', 'tpl'].forEach(function (k) {
        if ((f[k] === undefined || f[k] === null || f[k] === '') && d[k] !== undefined && d[k] !== '') f[k] = d[k];
      });
    });
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
  /* 选项变更后广播：让已经渲染出来的表单同步刷新 */
  function notifyDict(name) {
    try { if (window.ERP && typeof ERP.onDictChange === 'function') ERP.onDictChange(name); } catch (e) {}
  }
  function setDict(name, arr) {
    var o = lsGet(D_KEY, {}) || {};
    o[name] = arr;
    lsSet(D_KEY, o);
    notifyDict(name);
  }
  function delDict(name) {
    var o = lsGet(D_KEY, {}) || {};
    delete o[name];
    lsSet(D_KEY, o);
    notifyDict(name);
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
     notifyDict(newName);
  }

  /* ---------- 字段取值（下拉选项） ---------- */
  function optionsOf(field) {
    field = field || {};
    var out = [];
    if (field.options && field.options.length) {
      // radio 形式 [[val,label],...] 或 select 形式 ['a','b']
      out = field.options.map(function (o) {
        return Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: o };
      });
    } else if (field.dict) {
      out = dict(field.dict).map(function (o) { return { value: o, label: o }; });
    }
    /* 动态来源：台账 / 资料库里新增记录后选项自动出现，不用回来改配置。
       台账来的排最前——它才是权威来源，字典里的只作兜底。 */
    var dyn = sourceValues(field).map(function (v) { return { value: v, label: v }; });
    if (dyn.length) {
      var seen = {};
      dyn.forEach(function (o) { seen[String(o.value)] = 1; });
      out = dyn.concat(out.filter(function (o) { return !seen[String(o.value)]; }));
    }
    return out;
  }

  /* ---------- 动态选项来源 ----------
     from:'erp:equip.name'                     → ERP「检测设备一览表」的名称列
     from:'pqs:doc' + tpl:'{code} {name}（{ver}）' → 品质资料库「受控文件」整表，按模板拼 */
  function pqsDB() {
    var db = null;
    try { if (window.DATAHUB && DATAHUB.get) db = DATAHUB.get('pqs'); } catch (e) { db = null; }
    if (!db) { try { db = JSON.parse(localStorage.getItem('gls_pqs_db_v1') || 'null'); } catch (e) { db = null; } }
    if (!db && window.PQS_DATA) {
      var d = window.PQS_DATA;
      db = { material: d.materials, param: d.params, process: d.processes, product: d.products,
             supplier: d.suppliers, doc: d.docs, sampling: d.sampling };
    }
    return db || {};
  }
  /* 账号人员：from:'user:检验,IQC' —— 按「岗位 / 部门 / 姓名」模糊匹配已注册账号。
     一个都没匹配上时列出全部在用账号，保证下拉永远不会空；不写关键词 = 全部人。 */
  function userAccounts() {
    var arr = null;
    try { if (window.DATAHUB && DATAHUB.get) arr = DATAHUB.get('accounts'); } catch (e) { arr = null; }
    if (arr && !Array.isArray(arr)) arr = arr.users || arr.list || null;
    if (!Array.isArray(arr)) {
      try {
        var c = JSON.parse(localStorage.getItem('gls_quality_data_v2') || 'null');
        if (c && Array.isArray(c.accounts)) arr = c.accounts;
        else if (c && c.accounts && Array.isArray(c.accounts.users)) arr = c.accounts.users;
      } catch (e) { arr = null; }
    }
    if (!Array.isArray(arr)) {
      try {
        var a2 = JSON.parse(localStorage.getItem('gls_accounts') || '[]');
        arr = a2 && !Array.isArray(a2) ? (a2.users || a2.list || []) : a2;
      } catch (e) { arr = []; }
    }
    return Array.isArray(arr) ? arr : [];
  }
  function userNames(kw) {
    var all = userAccounts().filter(function (u) {
      return u && u.status !== 'disabled' && (u.realname || u.username);
    });
    var kws = String(kw == null ? '' : kw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var list = all;
    if (kws.length) {
      var hit = all.filter(function (u) {
        var hay = [u.post, u.dept, u.realname, u.username, u.role].join(' ');
        for (var i = 0; i < kws.length; i++) { if (hay.indexOf(kws[i]) >= 0) return true; }
        return false;
      });
      if (hit.length) list = hit;
    }
    var out = [];
    list.forEach(function (u) {
      var nm = String(u.realname || u.username || '').replace(/\s+/g, ' ').trim();
      if (nm && out.indexOf(nm) < 0) out.push(nm);
    });
    return out;
  }
  function sourceValues(f) {
    if (!f || !f.from) return [];
    var p = String(f.from).split(':'), kind = p[0], rest = p.slice(1).join(':');
    if (kind === 'user') return userNames(rest);
    var q = rest.split('.'), table = q[0] || '', col = q[1] || '';
    var rows = [];
    try {
      if (kind === 'erp') rows = (window.ERP && ERP._listOf) ? (ERP._listOf(table) || []) : [];
      else if (kind === 'pqs') { var db = pqsDB(); rows = (db && db[table]) || []; }
    } catch (e) { rows = []; }
    var out = [];
    rows.forEach(function (r) {
      if (!r) return;
      var s;
      if (f.tpl) {
        s = String(f.tpl).replace(/\{(\w+)\}/g, function (m, k) { return r[k] == null ? '' : String(r[k]); });
      } else {
        s = col ? (r[col] == null ? '' : String(r[col])) : '';
      }
      s = String(s).replace(/\s+/g, ' ').trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
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
      /* 老记录里的值可能不在当前选项里（人离职、选项改过），补一个选项进去，编辑时不会被清空 */
      if (v !== '' && v != null) {
        var hasV = false;
        for (var oi = 0; oi < opts.length; oi++) { if (String(opts[oi].value) === String(v)) { hasV = true; break; } }
        if (!hasV) opts = [{ value: v, label: v }].concat(opts);
      }
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
    } else if (f.type === 'multiselect') {
      h += msHtml(moduleId, f, v, id);
    } else if (f.calc) {
      var _t = (f.type === 'number') ? 'number' : 'text';
      h += '<input id="' + id + '" type="' + _t + '" value="' + esc(v) + '" readonly class="fx-calc"'
        + ' data-fxcalc="' + esc(f.calc) + '" data-fxdec="' + esc(f.decimals) + '" title="自动计算：' + esc(f.calc) + '">';
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
    '.fx-row input.fx-calc{background:#eef7f1;color:#14663c;font-weight:600;border-color:#b7ddc6}',
    '.fx-ms{position:relative;flex:1;min-width:0}',
    '.fx-ms-box{display:flex;align-items:center;gap:6px;min-height:40px;padding:6px 11px;border:1px solid #d1d5db;border-radius:7px;background:#fff;cursor:pointer;flex-wrap:wrap}',
    '.fx-ms-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0;align-items:center}',
    '.fx-ms-ph{color:#9ca3af;font-size:14px}',
    '.fx-ms-chip{display:inline-flex;align-items:center;gap:5px;background:#eef7f1;color:#14663c;border:1px solid #b7ddc6;border-radius:5px;padding:2px 7px;font-size:13px;line-height:1.5}',
    '.fx-ms-chip>b{cursor:pointer;color:#94a3b8;font-weight:700;font-size:14px}',
    '.fx-ms-chip>b:hover{color:#dc2626}',
    '.fx-ms-ar{color:#9ca3af;font-size:12px;flex:none}',
    '.fx-ms-panel{position:absolute;z-index:80;left:0;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.13);padding:8px}',
    '.fx-ms-sr input{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit}',
    '.fx-ms-list{margin-top:6px;max-height:230px;overflow:auto;display:flex;flex-direction:column}',
    '.fx-ms-opt{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1.4}',
    '.fx-ms-opt:hover{background:#f3f7f4}',
    '.fx-ms-opt.on{background:#eef7f1;color:#14663c;font-weight:600}',
    '.fx-ms-opt input{width:16px;height:16px;flex:none;margin:0}',
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

  /* ==================== 自动计算（联动） ====================
     字段上写 { calc: 'badQty/sampleQty*100' } 即自动算：
       源数据没填全时不动，避免把已有值清零；
       源数据一填全就立刻刷新，人不用手算。 */
  function numOf(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function refsOf(expr) {
    var out = [], re = /[a-zA-Z_][a-zA-Z0-9_]*/g, m;
    while ((m = re.exec(String(expr)))) if (out.indexOf(m[0]) < 0) out.push(m[0]);
    return out;
  }
  function calcFields(box) {
    if (!box) return;
    if (!box.classList || !box.classList.contains('fx-form')) {
      box = box.closest ? box.closest('.fx-form') : null;
    }
    if (!box) return;
    var moduleId = box.getAttribute('data-module');
    if (!moduleId) return;
    var all = get(moduleId).filter(function (f) { return f.enabled !== false; });
    var vals = {};
    all.forEach(function (g) {
      if (g.type === 'html') return;
      var e = box.querySelector('#fx_' + moduleId + '_' + g.key);
      if (e) vals[g.key] = e.value;
    });
    all.forEach(function (f) {
      if (!f.calc) return;
      var el = box.querySelector('#fx_' + moduleId + '_' + f.key);
      if (!el) return;
      var blank = false;
      refsOf(f.calc).forEach(function (k) {
        if (String(vals[k] == null ? '' : vals[k]).trim() === '') blank = true;
      });
      if (blank) return;
      var expr = String(f.calc).replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, function (m) {
        return 'numOf(vals["' + m + '"])';
      });
      var v = 0;
      try { v = eval(expr); } catch (e) { return; }
      if (isNaN(v) || !isFinite(v)) return;
      var d = (f.decimals == null ? 2 : f.decimals);
      var s = Number(v).toFixed(d);
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      if (String(el.value) !== s) el.value = s;
    });
  }
  (function bindCalc() {
    function onEv(ev) {
      var t = ev.target;
      if (!t || !t.id || String(t.id).indexOf('fx_') !== 0) return;
      var box = t.closest ? t.closest('.fx-form') : null;
      if (box) calcFields(box);
    }
    document.addEventListener('input', onEv, true);
    document.addEventListener('change', onEv, true);
  })();

  /* ==================== 多选下拉控件 ==================== */
  function msHtml(moduleId, f, v, id) {
    var opts = optionsOf(f);
    var sel = String(v == null ? '' : v).split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return x !== ''; });
    /* 已存进记录里的值，就算选项里没有也要显示，不能丢 */
    sel.forEach(function (s) {
      var has = false;
      opts.forEach(function (o) { if (String(o.value) === s) has = true; });
      if (!has) opts.push({ value: s, label: s });
    });
    var ph = f.placeholder || '请选择（可多选）';
    var h = '<div class="fx-ms" data-dict="' + esc(f.dict || '') + '" data-ph="' + esc(ph) + '">';
    h += '<input type="hidden" id="' + id + '" value="' + esc(sel.join(',')) + '">';
    h += '<div class="fx-ms-box" onclick="FIELDS.msToggle(this)"><span class="fx-ms-chips">';
    h += sel.length
      ? sel.map(function (s) {
          return '<span class="fx-ms-chip">' + esc(s)
            + '<b data-v="' + esc(s) + '" onclick="event.stopPropagation();FIELDS.msDel(this)">×</b></span>';
        }).join('')
      : '<span class="fx-ms-ph">' + esc(ph) + '</span>';
    h += '</span><span class="fx-ms-ar">▾</span></div>';
    h += '<div class="fx-ms-panel" hidden><div class="fx-ms-sr">'
      + '<input type="text" placeholder="搜索；要新增的项输入后按回车" onkeydown="FIELDS.msKey(this, event)">'
      + '</div><div class="fx-ms-list">';
    opts.forEach(function (o) {
      var on = sel.indexOf(String(o.value)) >= 0;
      h += '<label class="fx-ms-opt' + (on ? ' on' : '') + '">'
        + '<input type="checkbox" value="' + esc(o.value) + '"' + (on ? ' checked' : '')
        + ' onchange="FIELDS.msPick(this)"><span>' + esc(o.label) + '</span></label>';
    });
    h += '</div></div></div>';
    return h;
  }
  function msOf(el) { return el && el.closest ? el.closest('.fx-ms') : null; }
  function msSync(ms) {
    if (!ms) return;
    var hid = ms.querySelector('input[type=hidden]');
    if (!hid) return;
    var sel = [];
    Array.prototype.forEach.call(ms.querySelectorAll('.fx-ms-list input[type=checkbox]'), function (c) {
      if (c.checked) sel.push(c.value);
    });
    hid.value = sel.join(',');
    var box = ms.querySelector('.fx-ms-chips');
    if (!box) return;
    var ph = ms.getAttribute('data-ph') || '请选择（可多选）';
    box.innerHTML = sel.length
      ? sel.map(function (s) {
          return '<span class="fx-ms-chip">' + esc(s)
            + '<b data-v="' + esc(s) + '" onclick="event.stopPropagation();FIELDS.msDel(this)">×</b></span>';
        }).join('')
      : '<span class="fx-ms-ph">' + esc(ph) + '</span>';
  }
  function msToggle(box) {
    var ms = msOf(box); if (!ms) return;
    var p = ms.querySelector('.fx-ms-panel'); if (!p) return;
    var willOpen = p.hidden;
    Array.prototype.forEach.call(document.querySelectorAll('.fx-ms-panel'), function (x) { x.hidden = true; });
    p.hidden = !willOpen;
    if (!p.hidden) {
      var s = p.querySelector('.fx-ms-sr input');
      if (s) setTimeout(function () { try { s.focus(); } catch (e) {} }, 30);
    }
  }
  function msPick(cb) {
    var ms = msOf(cb); if (!ms) return;
    var lb = cb.closest ? cb.closest('.fx-ms-opt') : null;
    if (lb) lb.className = 'fx-ms-opt' + (cb.checked ? ' on' : '');
    msSync(ms);
  }
  function msDel(b) {
    var ms = msOf(b); if (!ms) return;
    var v = b.getAttribute('data-v');
    Array.prototype.forEach.call(ms.querySelectorAll('.fx-ms-list input[type=checkbox]'), function (c) {
      if (c.value === v) {
        c.checked = false;
        var lb = c.closest ? c.closest('.fx-ms-opt') : null;
        if (lb) lb.className = 'fx-ms-opt';
      }
    });
    msSync(ms);
  }
  function msKey(input, ev) {
    if (!ev || ev.key !== 'Enter') return;
    ev.preventDefault();
    var ms = msOf(input); if (!ms) return;
    var v = String(input.value || '').trim();
    if (!v) return;
    var list = ms.querySelector('.fx-ms-list');
    var hit = null;
    Array.prototype.forEach.call(list.querySelectorAll('input[type=checkbox]'), function (c) {
      if (c.value === v) hit = c;
    });
    if (!hit) {
      var lb = document.createElement('label');
      lb.className = 'fx-ms-opt on';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = v; cb.checked = true;
      cb.setAttribute('onchange', 'FIELDS.msPick(this)');
      var sp = document.createElement('span'); sp.textContent = v;
      lb.appendChild(cb); lb.appendChild(sp);
      list.appendChild(lb);
    } else {
      hit.checked = true;
      var lb2 = hit.closest ? hit.closest('.fx-ms-opt') : null;
      if (lb2) lb2.className = 'fx-ms-opt on';
    }
    input.value = '';
    msSync(ms);
    /* 新增的项存进字典，下次打开还在 */
    var dn = ms.getAttribute('data-dict');
    if (dn) {
      try {
        var arr = dict(dn).slice();
        if (arr.indexOf(v) < 0) { arr.push(v); setDict(dn, arr); }
      } catch (e) {}
    }
  }
  /* 点空白处收起面板 */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var inMs = t && t.closest ? t.closest('.fx-ms') : null;
    Array.prototype.forEach.call(document.querySelectorAll('.fx-ms-panel'), function (p) {
      if (p.hidden) return;
      var ms = p.closest ? p.closest('.fx-ms') : null;
      if (ms !== inMs) p.hidden = true;
    });
  }, false);

  window.FIELDS = {
    /* 数据 */
    get: get, save: save, reset: reset, isCustom: isCustom, moduleIds: moduleIds,
    moduleName: function (id) { return MODULE_NAMES[id] || id; },
    defaults: function (id) { return (DEFAULT_FIELDS[id] || []).map(function (f) { return Object.assign({}, f); }); },
    /* 字典 */
    dicts: allDicts, dict: dict, setDict: setDict, delDict: delDict, renameDict: renameDict,
    /* 渲染与读写 */
    render: render, collect: collect, validate: validate, optionsOf: optionsOf, esc: esc,
    calc: calcFields,
    /* 多选下拉控件（供内联 onclick 调用） */
    msToggle: msToggle, msPick: msPick, msDel: msDel, msKey: msKey,
    sources: sourceValues,
    /* 界面（在 gls-fields-ui.js 中实现，挂载到此处） */
    openDesigner: function (id) { alert('配置界面未加载'); }
  };
})();
