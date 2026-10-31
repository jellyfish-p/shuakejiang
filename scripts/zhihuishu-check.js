const assert = require('assert/strict');
const { runtime } = require('./test-runtime');

function element(r, { text = '', classes = [], attrs = {}, selectors = {}, all = {}, onClick = null } = {}) {
  const node = r.node(text);
  const classSet = new Set(classes);
  const syncClassName = () => { node.className = Array.from(classSet).join(' '); };
  syncClassName();
  node.classList = {
    contains: name => classSet.has(name),
    add: name => { classSet.add(name); syncClassName(); },
    remove: name => { classSet.delete(name); syncClassName(); }
  };
  node.getAttribute = name => attrs[name] ?? null;
  node.querySelector = selector => selectors[selector] || null;
  node.querySelectorAll = selector => {
    const value = all[selector] || selectors[selector];
    return value ? (Array.isArray(value) ? value : [value]) : [];
  };
  node.click = () => {
    node.clicks += 1;
    if (onClick) onClick(node, classSet);
  };
  return node;
}

const r = runtime();
const va = new r.VideoAssistant();

// New directory markup: .course-catalog > .chapter-item.current, with progress aria value.
const progress = element(r, { attrs: { 'aria-valuenow': '100' } });
const first = element(r, {
  classes: ['chapter-item', 'current'],
  selectors: {
    '.item-num': element(r, { text: '0.1' }),
    '.item-name': element(r, { text: '第一节' }),
    '[role="progressbar"][aria-valuenow], [aria-valuenow]': progress
  }
});
const second = element(r, {
  classes: ['chapter-item'],
  selectors: {
    '.item-num': element(r, { text: '0.2' }),
    '.item-name': element(r, { text: '第二节' })
  }
});
const catalog = element(r, { all: { '.chapter-item': [first, second] } });
r.document.select('.course-catalog', catalog);
const sections = va.zhsSections();
assert.equal(sections.length, 2);
assert.equal(sections[0], first);
assert.equal(sections[1], second);
assert.equal(va.zhsActiveSection(sections), first);
assert.equal(va.zhsIsSectionDone(first), true);
assert.equal(va.zhsSectionKey(first), '0.1:第一节');

// Speed is selected through the control bar rather than the media element.
const activeTab = element(r, { classes: ['speedTab', 'active'], attrs: { rate: '1.0' } });
const fastTab = element(r, {
  classes: ['speedTab'],
  attrs: { rate: '1.5' },
  onClick: (_, classSet) => {
    activeTab.classList.remove('active');
    classSet.add('active');
  }
});
const bar = element(r, {
  all: { '.speedBox .speedTab[rate], .speedTab[rate]': [activeTab, fastTab] }
});
r.document.select('.controlsBar', bar);
assert.equal(va.zhsApplyControlBarRate(1.5), true);
assert.equal(fastTab.clicks, 1);
assert.equal(fastTab.classList.contains('active'), true);

// New AI exercise dialog markup: parse .item/.type/.question-info/.option and click B.
const bSelect = element(r, { classes: ['class-question-select'], onClick: node => node.classList.add('active') });
const optionA = element(r, {
  selectors: { '.answer': element(r, { text: '140' }), '.class-question-select': element(r, { classes: ['class-question-select'] }) }
});
const optionB = element(r, {
  selectors: { '.answer': element(r, { text: '141' }), '.class-question-select': bSelect }
});
const questionItem = element(r, {
  selectors: {
    '.type': element(r, { text: '1. [单选题]' }),
    '.question-info': element(r, { text: '我国现行宪法共计（ ）条。' })
  },
  all: { '.option': [optionA, optionB] }
});
const dialog = element(r, { all: { '.ques-list .item': [questionItem] } });
const questions = va.zhsPopupQuestions(dialog);
assert.equal(questions.length, 1);
assert.equal(questions[0].questionType, '单选题');
assert.equal(Array.from(questions[0].options).join('|'), '140|141');
assert.equal(va.zhsFillPopupQuestion(questions[0], 'B'), true);
assert.equal(bSelect.classList.contains('active'), true);

console.log('Zhihuishu checks passed (3 cases).');
