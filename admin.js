import { call, ApiError } from './api.js';
import { accessToken, hasSession, signIn, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const list = $('request-list');
const note = $('queue-note');
let filter = 'pending';
let page = 0;
let loadId = 0;

async function api(path, options) {
  return call('admin/' + path, { ...options, accessToken: await accessToken() });
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
      const response = await fetch(url);
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
function timeLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  return [hours && hours + ' hr', (minutes % 60) && (minutes % 60) + ' min'].filter(Boolean).join(' ');
}
function setNote(message) {
  note.textContent = message;
  note.hidden = !message;
}
function renderRequest(row) {
  const fragment = $('request-template').content.cloneNode(true);
  const get = (selector) => fragment.querySelector(selector);
  const date = new Date(row.submitted_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  get('.request-project').textContent = row.project;
  get('.request-meta').textContent = [row.submitter, timeLabel(row.minutes), date].join(' · ');
  get('.request-material').textContent = row.material ? 'Material: ' + row.material : 'Material: unspecified';
  const badge = get('.badge');
  function updateBadge() {
    badge.dataset.status = row.status;
    badge.textContent = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' }[row.status];
  }
  updateBadge();
  const downloads = get('.downloads');
  const downloadMessage = get('.download-message');
  for (const [index, file] of row.files.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.textContent = 'Download ' + file.name;
    button.addEventListener('click', () => void downloadFile(row.id, index, button, downloadMessage));
    downloads.append(button);
  }
  const review = get('.review-form');
  review.elements.comment.value = row.comment;
  const message = get('.review-message');
  review.addEventListener('submit', async (event) => {
    event.preventDefault();
    const action = event.submitter?.dataset.action || 'comment';
    const buttons = review.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    message.hidden = false;
    message.textContent = 'Saving…';
    try {
      const updated = await api('queue/' + row.id, {
        method: 'PATCH',
        json: { status: action === 'comment' ? row.status : action, comment: review.elements.comment.value, revision: row.revision },
      });
      Object.assign(row, updated);
      updateBadge();
      message.textContent = action === 'comment' ? 'Comment saved.' : 'Decision saved.';
      if (filter && filter !== row.status) {
        const resultMessage = message.textContent;
        await loadQueue();
        if (note.hidden) setNote(resultMessage);
      }
    } catch (failure) {
      message.textContent = failure.message;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });
  return fragment;
}
async function loadQueue() {
  const current = ++loadId;
  list.replaceChildren();
  $('pages').hidden = true;
  setNote('Loading requests…');
  try {
    const result = await api('queue?' + new URLSearchParams({ status: filter, page }));
    if (current !== loadId) return;
    if (!result.items.length && page > 0) {
      page--;
      return loadQueue();
    }
    result.items.forEach((row) => list.append(renderRequest(row)));
    setNote(result.items.length ? '' : (filter ? 'No ' + filter + ' requests.' : 'No print requests yet.'));
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
const login = $('login-form');
function loginMessage(message) {
  $('login-message').textContent = message;
  $('login-message').hidden = !message;
}
async function openQueue() {
  await api('session');
  $('gate').hidden = true;
  $('queue').hidden = false;
  await loadQueue();
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
$('sign-out').addEventListener('click', async () => {
  await signOut().catch(() => {});
  loadId++;
  list.replaceChildren();
  $('queue').hidden = true;
  $('gate').hidden = false;
  login.elements.email.focus();
});
if (hasSession()) {
  void openQueue().catch(async (error) => {
    if (error.status === 403) await signOut().catch(() => {});
    if (error.status !== 401) loginMessage(error.message);
  });
}

