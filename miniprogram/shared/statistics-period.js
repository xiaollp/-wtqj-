function monthLabel(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}
function statisticsPeriod(period, range, now = new Date()) {
  const maxMonth = monthLabel(now);
  const valid = typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const selected = !valid || period > maxMonth ? maxMonth : period;
  const [year, month] = selected.split('-').map(Number);
  const start = new Date(year, month - (range === 'SIX' ? 6 : 1), 1).getTime();
  const end = Math.min(new Date(year, month, 1).getTime() - 1, now.getTime());
  return {
    period: selected,
    today: maxMonth + '-' + String(now.getDate()).padStart(2, '0'),
    from_to: [start, end]
  };
}
module.exports = { monthLabel, statisticsPeriod };
