'use strict';
const { assert, text } = require('./domain.cjs');
function contacts(value = []) {
  if (typeof value === 'string') value = value.split(/\r?\n/).filter(s => s.trim()).map(line => {
    const [name, mobile = '', userId = '', ...rest] = line.split(/[,，]/).map(v => v.trim());
    assert(!rest.length, '常用成员每行按“姓名,手机号,用户ID”填写'); return { name, mobile, userId };
  });
  assert(Array.isArray(value) && value.length <= 50, '每个渠道最多配置 50 位常用成员');
  const result = value.map(p => {
    const name = text(p.name, '成员姓名', 40), mobile = String(p.mobile || '').trim(), userId = String(p.userId || '').trim();
    assert(mobile || userId, `${name} 至少需要手机号或用户 ID`);
    assert(!mobile || /^\+?\d{5,20}$/.test(mobile), `${name} 的手机号格式无效`);
    assert(!userId || /^[a-zA-Z0-9_-]{1,80}$/.test(userId), `${name} 的用户 ID 格式无效`);
    return { name, mobile, userId };
  });
  assert(new Set(result.map(p => p.name.toLocaleLowerCase())).size === result.length, '同一渠道的常用成员姓名不能重复');
  return result;
}
module.exports = { contacts };
