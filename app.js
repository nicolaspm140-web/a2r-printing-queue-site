import { call } from './api.js';

const $ = (id) => document.getElementById(id);
const form = $('submit-form');
const design = $('design');
const drop = $('dropzone');
const caption = $('file-caption');
const originalCaption = caption.innerHTML;
const trackForm = $('track-form');
const trackResult = $('track-result');
const chunkSize = 4 * 1024 * 1024;
const mb = 1024 * 1024;
const codePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let files = [];
let draft;

function field(tag, text, className = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function setError(message) {
  $('submit-error').textContent = message;
  $('submit-error').hidden = !message;
}
function renderFiles() {
  const list = $('file-list');
  list.replaceChildren();
  for (const [index, file] of files.entries()) {
    const item = field('li', '');
    item.append(field('span', file.name + ' · ' + Math.max(0.1, file.size / mb).toFixed(1) + ' MB'));
    const remove = field('button', 'Remove', 'text-button');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.addEventListener('click', () => {
      files.splice(index, 1);
      draft = undefined;
      setError('');
      renderFiles();
      design.focus();
    });
    item.append(remove);
    list.append(item);
  }
  list.hidden = !files.length;
  caption.classList.toggle('selected', Boolean(files.length));
  if (files.length) caption.textContent = 'Add more STEP files';
  else caption.innerHTML = originalCaption;
}
function selectFiles(next) {
  setError('');
  const unique = new Map(files.map((file) => [[file.name, file.size, file.lastModified].join('\0'), file]));
  for (const file of next) {
    if (!/\.(step|stp)$/i.test(file.name)) {
      setError(file.name + ' must be a .STEP or .STP file. STL and 3MF files are rejected.');
      continue;
    }
    if (!file.size || file.size > 150 * mb || file.name.length > 180) {
      setError(file.name + ' exceeds the filename or file size limit, or is empty.');
      continue;
    }
    unique.set([file.name, file.size, file.lastModified].join('\0'), file);
  }
  const chosen = [...unique.values()];
  if (chosen.length > 12 || chosen.reduce((sum, file) => sum + file.size, 0) > 600 * mb) {
    return setError('Choose up to 12 files totaling 600 MB or less.');
  }
  files = chosen;
  draft = undefined;
  renderFiles();
}
design.addEventListener('change', () => {
  selectFiles(design.files);
  design.value = '';
});
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!design.disabled) drop.classList.add('drag');
});
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('drag');
  if (!design.disabled) selectFiles(event.dataTransfer.files);
});

async function retry(action) {
  for (const delay of [500, 1500, 0]) {
    try { return await action(); } catch (error) {
      if (!delay || ![0, 500, 502, 503, 504].includes(error.status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
function progress(bytes, total, message) {
  $('upload-status').hidden = false;
  $('upload-progress').value = 100 * bytes / total;
  $('upload-caption').textContent = message;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('');
  const minutes = Number($('hours').value) * 60 + Number($('minutes').value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    setError('Enter an estimated print time between 1 minute and 168 hours.');
    return $('hours').focus();
  }
  if (!files.length) {
    setError('Choose at least one STEP file to submit.');
    return design.focus();
  }
  const fields = new FormData(form);
  const details = { submitter: fields.get('submitter'), project: fields.get('project'), minutes, material: fields.get('material'),
    files: files.map(({name, size}) => ({ name, bytes: size })) };
  const signature = JSON.stringify(details);
  if (draft?.signature !== signature) draft = { signature, tracking: crypto.randomUUID(), uploaded: new Set() };
  const controls = form.querySelectorAll('input, button');
  controls.forEach((control) => { control.disabled = true; });
  const total = files.reduce((sum, file) => sum + file.size, 0);
  try {
    progress(0, total, 'Preparing the upload…');
    const request = await retry(() => call('begin', { method: 'POST', json: { ...details, tracking: draft.tracking } }));
    if (!request.submitted) {
      let bytes = 0;
      for (const [index, file] of files.entries()) {
        progress(bytes, total, 'Uploading file ' + (index + 1) + ' of ' + files.length + '…');
        for (let offset = 0, part = 0; offset < file.size; offset += chunkSize, part++) {
          const id = index + '/' + part;
          const body = file.slice(offset, offset + chunkSize);
          if (!draft.uploaded.has(id)) {
            await retry(() => call('upload/' + request.id + '/' + id, { method: 'PUT', body, tracking: draft.tracking }));
            draft.uploaded.add(id);
          }
          bytes += body.size;
          $('upload-progress').value = 100 * bytes / total;
        }
      }
      progress(total, total, 'Checking your files…');
      await retry(() => call('finish/' + request.id, { method: 'POST', tracking: draft.tracking }));
    }
    const url = new URL(location.pathname, location.origin);
    url.hash = 'track=' + draft.tracking;
    $('receipt-link').value = url.href;
    $('open-track').href = url.hash;
    $('receipt-project').textContent = request.project + ' is pending lab review.';
    form.hidden = true;
    $('receipt').hidden = false;
    $('receipt').focus();
  } catch (error) {
    $('upload-status').hidden = true;
    if (error.status === 410) draft = undefined;
    setError(error.message);
  } finally {
    controls.forEach((control) => { control.disabled = false; });
  }
});

$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('receipt-link').value);
    $('copy-link').textContent = 'Link copied';
  } catch {
    $('receipt-link').focus();
    $('receipt-link').select();
  }
});
$('another').addEventListener('click', () => {
  $('receipt').hidden = true;
  $('upload-status').hidden = true;
  form.reset();
  files = [];
  draft = undefined;
  renderFiles();
  $('copy-link').textContent = 'Copy tracking link';
  form.hidden = false;
  form.elements.submitter.focus();
});

async function lookup() {
  const raw = $('tracking').value.trim();
  const code = raw.includes('#track=') ? raw.split('#track=').at(-1) : raw;
  trackResult.hidden = false;
  trackResult.className = 'notice';
  trackResult.textContent = 'Looking up request…';
  const button = trackForm.querySelector('button');
  button.disabled = true;
  try {
    if (!codePattern.test(code)) throw new Error('Enter the tracking code or link from your submission receipt.');
    const row = await call('track', { method: 'POST', json: { tracking: code } });
    const badge = field('span', { pending: 'Pending review', accepted: 'Accepted', rejected: 'Rejected' }[row.status], 'badge');
    badge.dataset.status = row.status;
    const hours = Math.floor(row.minutes / 60);
    const time = [hours && hours + ' hr', (row.minutes % 60) && (row.minutes % 60) + ' min'].filter(Boolean).join(' ');
    trackResult.className = 'track-card';
    trackResult.replaceChildren(badge, field('h3', row.project), field('p', [time, row.material].filter(Boolean).join(' · ')));
    if (row.comment) trackResult.append(field('p', row.comment));
  } catch (error) {
    trackResult.className = 'notice error';
    trackResult.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
trackForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void lookup();
});
function openTrackingLink() {
  if (!location.hash.startsWith('#track=')) return;
  $('tracking').value = location.hash.slice(7);
  $('track').scrollIntoView({ block: 'center' });
  void lookup();
}
window.addEventListener('hashchange', openTrackingLink);
openTrackingLink();

