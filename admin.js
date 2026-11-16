import { call, ApiError } from './api.js';
import { accessToken, signIn, signOut } from './auth.js';
import { field, priorityLabels, projectStatuses, setBadge, timeLabel } from './queue.js?v=review-priority';

const $ = (id) => document.getElementById(id);
const list = $('request-list');
const note = $('queue-note');
let filter = 'pending';
let page = 0;
let loadId = 0;

async function api(path, options) {
  try {
    return await call('admin/' + path, { ...options, accessToken: await accessToken() });
  } catch (error) {
    if ((error.status === 401 || error.status === 403) && !$('queue').hidden) {
      showSignIn('Your admin session ended. Sign in again.');
      void signOut().catch(() => {});
    }
    throw error;
  }
}
async function downloadFile(id, index, button, message) {
  button.disabled = true;
  message.hidden = false;
  try {
    message.textContent = 'Preparing download…';
    const file = await api('queue/' + id + '/files/' + index);
    const parts = [];
    for (const [number, url] of file.parts.entries()) {
      message.textContent = 'Downloading part ' + (number + 1) + ' of ' + file.parts.length + '…';
      const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('Download interrupted. Try again.');
      parts.push(await response.blob());
    }
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    message.hidden = true;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
function setNote(message) {
  note.textContent = message;
  note.hidden = !message;
}
function renderRequest(row) {
  const fragment = $('request-template').content.cloneNode(true);
  const requestCard = fragment.querySelector('.request');
  const get = (selector) => requestCard.querySelector(selector);
  const decisionButton = get('.request-decision');
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const date = dateFormat.format(new Date(row.submitted_at));
  get('.request-project').textContent = row.project;
  get('.request-meta').textContent = [row.submitter, timeLabel(row.minutes), date].join(' · ');
  get('.request-material').textContent = row.material ? 'Filament: ' + row.material : 'Filament: No preference';
  get('.request-submission-note').textContent = row.submission_note || 'No print requirements were recorded.';
  const badge = get('.request-status');
  const priorityBadge = get('.request-priority');
  const pieces = get('.piece-list');
  const projectActions = get('.project-actions');
  const decisionActions = get('.decision-actions');
  const downloadMessage = get('.download-message');
  const review = get('.review-form');
  const message = get('.review-message');
  const prioritySelect = review.elements.priority;
  prioritySelect.append(...priorityLabels.map((label, value) => new Option(label, String(value))));
  review.elements.comment.value = row.comment;
  get('.save-priority').addEventListener('click', () => void saveReview('priority'));
  const dialog = get('.review-dialog');
  const reviewerForm = get('.reviewer-form');
  const decisionError = get('.decision-error');
  let decision;
  function askReviewer(action, label) {
    decision = action;
    dialog.setAttribute('aria-label', label);
    get('.decision-title').textContent = label;
    get('.decision-project').textContent = row.project;
    get('.confirm-decision').textContent = label;
    reviewerForm.reset();
    decisionError.hidden = true;
    dialog.showModal();
  }
  get('.cancel-decision').addEventListener('click', () => dialog.close());
  reviewerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = reviewerForm.elements.reviewer.value.trim();
    if (!name) {
      decisionError.textContent = 'Enter the name of the admin making this decision.';
      decisionError.hidden = false;
      reviewerForm.elements.reviewer.focus();
      return;
    }
    decisionError.hidden = true;
    void saveReview(decision, undefined, name);
  });
  decisionButton.addEventListener('click', () =>
    askReviewer(row.status === 'rejected' ? 'accept' : 'reject', decisionButton.textContent));
  function actionButton(label, action, style = 'secondary', piece) {
    const button = field('button', label, 'button ' + style);
    button.type = 'button';
    button.addEventListener('click', () => void saveReview(action, piece));
    return button;
  }
  function renderActions() {
    setBadge(badge, row.status);
    const priority = row.priority ?? 0;
    priorityBadge.className = 'request-priority badge priority-' + priority;
    priorityBadge.textContent = priorityLabels[priority];
    prioritySelect.value = String(priority);
    const rejected = row.status === 'rejected';
    decisionButton.textContent = rejected ? 'Accept rejected request' : 'Reject entire request';
    decisionButton.className = 'button request-decision ' + (rejected ? 'primary' : 'secondary reject');
    decisionButton.setAttribute('aria-label', decisionButton.textContent + ' for ' + row.project);
    const history = row.decision_history ?? [];
    get('.history-empty').hidden = history.length > 0;
    get('.decision-history').replaceChildren(...history.slice().reverse().map((entry) => field('li',
      (entry.action === 'accept' ? 'Accepted by ' : 'Rejected by ') + entry.reviewer + ' · ' + dateFormat.format(new Date(entry.at)))));
    pieces.replaceChildren();
    projectActions.replaceChildren();
    const commentButton = field('button', 'Save comment', 'button secondary');
    commentButton.type = 'submit';
    decisionActions.replaceChildren(commentButton);
    const working = row.status === 'in_process';
    const showState = working || row.status === 'finished' || Object.keys(row.piece_states).length > 0;
    for (const [index, file] of row.files.entries()) {
      const piece = field('div', '', 'piece-row');
      const state = row.piece_states[index] || 'waiting';
      const name = field('div', '', 'piece-name');
      name.append(field('strong', file.name));
      if (showState) {
        const tag = field('span', '', 'badge');
        setBadge(tag, state, { waiting: 'Awaiting print', ready: 'Ready for pickup', delivered: 'Delivered' }[state]);
        name.append(tag);
      }
      const controls = field('div', '', 'piece-actions');
      const button = field('button', 'Download', 'button secondary');
      button.type = 'button';
      button.setAttribute('aria-label', 'Download ' + file.name);
      button.addEventListener('click', () => void downloadFile(row.id, index, button, downloadMessage));
      controls.append(button);
      if (working && state !== 'delivered') {
        const ready = state === 'ready';
        const update = actionButton(ready ? 'Deliver piece' : 'Mark printed', ready ? 'deliver' : 'ready', 'secondary', index);
        update.setAttribute('aria-label', update.textContent + ' — ' + file.name);
        controls.append(update);
      }
      piece.append(name, controls);
      pieces.append(piece);
    }
    if (working) {
      if (row.files.some((_, index) => !row.piece_states[index])) projectActions.append(actionButton('Mark all printed', 'ready_all'));
      else projectActions.append(actionButton('Deliver whole project', 'deliver_all', 'primary'));
    }
    if (row.status === 'pending') {
      const accept = field('button', 'Accept request', 'button primary');
      accept.type = 'button';
      accept.addEventListener('click', () => askReviewer('accept', accept.textContent));
      decisionActions.append(accept);
    }
  }
  async function saveReview(action, piece, reviewer) {
    if (review.getAttribute('aria-busy') === 'true') return;
    review.setAttribute('aria-busy', 'true');
    const buttons = requestCard.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    message.hidden = false;
    message.textContent = 'Saving…';
    try {
      const updated = await api('queue/' + row.id, {
        method: 'PATCH',
        json: { action, piece, reviewer, priority: Number(prioritySelect.value), comment: review.elements.comment.value, revision: row.revision },
      });
      Object.assign(row, updated);
      if (reviewer && dialog.open) dialog.close();
      renderActions();
      message.textContent = { comment: 'Comment saved.', reject: 'Entire request rejected.', accept: 'Request accepted.', priority: 'Priority saved.' }[action] || 'Project updated.';
      if (filter && filter !== row.status) {
        await loadQueue(message.textContent);
      }
      if (action === 'priority') {
        page = 0;
        await loadQueue(message.textContent, { id: row.id, comment: review.elements.comment.value });
      }
    } catch (failure) {
      message.textContent = failure.message;
      if (reviewer && dialog.open) {
        decisionError.textContent = failure.message;
        decisionError.hidden = false;
      }
    } finally {
      review.removeAttribute('aria-busy');
      buttons.forEach((button) => { button.disabled = false; });
    }
  }
  renderActions();
  review.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveReview('comment');
  });
  return fragment;
}
async function loadQueue(resultMessage = '', editedRequest) {
  const current = ++loadId;
  list.replaceChildren();
  $('pages').hidden = true;
  setNote('Loading requests…');
  try {
    const result = await api('queue?' + new URLSearchParams({ status: filter, page }));
    if (current !== loadId) return;
    if (!result.items.length && page > 0) {
      page--;
      return loadQueue(resultMessage);
    }
    result.items.forEach((row) => {
      const card = renderRequest(row);
      if (row.id === editedRequest?.id) {
        card.querySelector('details').open = true;
        card.querySelector('.review-form').elements.comment.value = editedRequest.comment;
      }
      list.append(card);
    });
    const emptyMessage = filter ? 'No requests with status “' + projectStatuses[filter] + '”.' : 'No print requests yet.';
    setNote(result.items.length ? resultMessage : [resultMessage, emptyMessage].filter(Boolean).join(' '));
    $('pages').hidden = !(page > 0 || result.more);
    $('page-number').textContent = 'Page ' + (page + 1);
    $('prev').disabled = page === 0;
    $('next').disabled = !result.more;
  } catch (failure) {
    if (current === loadId) setNote(failure.message);
  }
}
for (const button of document.querySelectorAll('.filter')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.filter')) {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    }
    filter = button.dataset.filter;
    page = 0;
    void loadQueue();
  });
}
$('prev').addEventListener('click', () => { page--; void loadQueue(); });
$('next').addEventListener('click', () => { page++; void loadQueue(); });
const inventory = $('inventory');
const inventoryNote = $('inventory-note');
const addFilament = $('add-filament');
let inventoryLoad = 0;
function showInventoryNote(message, error = false) {
  inventoryNote.textContent = message;
  inventoryNote.hidden = !message;
  inventoryNote.classList.toggle('error', error);
}
async function saveFilament(event, existing) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const { material, color, brand, weight_grams, available } = form.elements;
  button.disabled = true;
  try {
    await api(existing ? 'filaments/' + existing.id : 'filaments', {
      method: existing ? 'PATCH' : 'POST',
      json: { material: material.value, color: color.value, brand: brand.value,
        weight_grams: weight_grams.value === '' ? null : weight_grams.valueAsNumber,
        available: available?.checked ?? true, revision: existing?.revision },
    });
    if (!existing) form.reset();
    await loadInventory('Filament saved.');
  } catch (error) {
    showInventoryNote(error.message, true);
    if (error.status === 409 && /changed/.test(error.message)) await loadInventory(error.message);
  } finally {
    button.disabled = false;
  }
}
function filamentEditor(item) {
  const form = field('form', '', 'filament-form filament-row');
  form.method = 'post';
  for (const [name, label, maxLength] of [['material', 'Material', 40], ['color', 'Color', 37], ['brand', 'Brand', 80],
    ['weight_grams', 'Remaining weight (g)', null]]) {
    const group = field('label', label);
    const input = field('input', '');
    Object.assign(input, { name, required: name === 'material' || name === 'color', value: item[name] ?? '' });
    if (maxLength === null) Object.assign(input, { type: 'number', min: '0', max: '2147483647', step: '1' });
    else input.maxLength = maxLength;
    group.append(input);
    form.append(group);
  }
  const available = field('label', '', 'availability');
  const checkbox = field('input', '');
  Object.assign(checkbox, { name: 'available', type: 'checkbox', checked: item.available });
  available.append(checkbox, ' Available');
  const button = field('button', 'Save', 'button secondary');
  button.type = 'submit';
  form.append(available, button);
  form.addEventListener('submit', (event) => void saveFilament(event, item));
  return form;
}
async function loadInventory(message = '') {
  const current = ++inventoryLoad;
  try {
    const { items } = await api('filaments');
    if (current !== inventoryLoad) return;
    inventory.replaceChildren(...items.map(filamentEditor));
    showInventoryNote(message || (items.length ? '' : 'No filaments added yet.'));
  } catch (error) {
    if (current === inventoryLoad) showInventoryNote(error.message, true);
  }
}
addFilament.addEventListener('submit', (event) => void saveFilament(event));
const login = $('login-form');
function loginMessage(message) {
  $('login-message').textContent = message;
  $('login-message').hidden = !message;
}
async function openQueue() {
  await api('session');
  $('gate').hidden = true;
  $('queue').hidden = false;
  $('filament-admin').hidden = false;
  await Promise.all([loadQueue(), loadInventory()]);
}
login.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage('');
  const button = login.querySelector('button');
  button.disabled = true;
  try {
    await signIn(login.elements.email.value.trim(), login.elements.password.value);
    login.reset();
    await openQueue();
  } catch (error) {
    if (error.status === 403) await signOut().catch(() => {});
    loginMessage(error instanceof ApiError ? error.message : 'Could not connect. Try again.');
  } finally {
    button.disabled = false;
  }
});
function showSignIn(message = '') {
  loadId++;
  inventoryLoad++;
  list.replaceChildren();
  inventory.replaceChildren();
  $('queue').hidden = true;
  $('filament-admin').hidden = true;
  $('gate').hidden = false;
  loginMessage(message);
  login.elements.email.focus();
}
$('sign-out').addEventListener('click', () => {
  showSignIn();
  void signOut().catch(() => {});
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    showSignIn();
    void signOut().catch(() => {});
  }
});

