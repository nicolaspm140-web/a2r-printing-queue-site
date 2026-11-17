export const projectStatuses = { pending: 'Pending review', accepted: 'Accepted', in_process: 'Printing started', finished: 'Finished', rejected: 'Rejected' };
export const priorityLabels = ['Normal priority', 'High priority', 'Urgent'];
export function decisionLabel(entry) {
  return (entry.action === 'accept' ? 'Accepted by ' : 'Rejected by ') + entry.reviewer;
}
export function timeLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours && hours + ' hr', remainder && remainder + ' min'].filter(Boolean).join(' ');
}
export function field(tag, text, className = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
export function setBadge(node, status, label = projectStatuses[status]) {
  node.dataset.status = status;
  node.textContent = label;
}
