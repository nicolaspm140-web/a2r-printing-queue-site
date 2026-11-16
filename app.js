import { call } from './api.js';
import { field, setBadge, timeLabel } from './queue.js';

const $ = (id) => document.getElementById(id);
const form = $('submit-form');
const design = $('design');
const drop = $('dropzone');
const caption = $('file-caption');
const originalCaption = caption.innerHTML;
const chunkSize = 4 * 1024 * 1024;
const mb = 1024 * 1024;
let files = [];
let draft;
let submitting = false;
let page = 0;
let filter = '';
let queueLoad = 0;
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
  if (files.length) caption.textContent = 'Add more design files';
  else caption.innerHTML = originalCaption;
}
function selectFiles(next) {
  setError('');
  const unique = new Map(files.map((file) => [[file.name, file.size, file.lastModified].join('\0'), file]));
  for (const file of next) {
    if (!/\.(step|stp|stl|3mf)$/i.test(file.name)) {
      setError(file.name + ' must be a STEP, STP, STL, or 3MF file.');
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
  if (submitting) return;
  setError('');
  const minutes = Number($('hours').value) * 60 + Number($('minutes').value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    setError('Enter an estimated print time between 1 minute and 168 hours.');
    return $('hours').focus();
  }
  if (!files.length) {
    setError('Choose at least one design file to submit.');
    return design.focus();
  }
  const fields = new FormData(form);
  const details = { submitter: fields.get('submitter'), project: fields.get('project'), minutes, filament_id: fields.get('filament') || null,
    files: files.map(({name, size}) => ({ name, bytes: size })) };
  const signature = JSON.stringify(details);
  if (draft?.signature !== signature) draft = { signature, tracking: crypto.randomUUID(), uploaded: new Set() };
  const controls = form.querySelectorAll('input, button, select');
  submitting = true;
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
    $('receipt-project').textContent = request.project + ' is pending lab review.';
    form.hidden = true;
    $('receipt').hidden = false;
    $('receipt').focus();
    page = 0;
    setFilter('');
    void loadQueue();
  } catch (error) {
    $('upload-status').hidden = true;
    if (error.status === 410) draft = undefined;
    if (error.status === 409) void loadFilaments();
    setError(error.message);
  } finally {
    submitting = false;
    controls.forEach((control) => { control.disabled = false; });
  }
});

$('another').addEventListener('click', () => {
  $('receipt').hidden = true;
  $('upload-status').hidden = true;
  form.reset();
  files = [];
  draft = undefined;
  renderFiles();
  form.hidden = false;
  form.elements.submitter.focus();
});

async function loadFilaments() {
  const note = $('filament-note');
  try {
    const { items } = await call('filaments');
    const select = form.elements.filament;
    const previous = select.value;
    if (!submitting) {
      select.replaceChildren(new Option('No preference', ''), ...items.map((item) => new Option(item.material + ' · ' + item.color, item.id)));
      select.value = items.some((item) => item.id === previous) ? previous : '';
    }
    $('filament-list').replaceChildren(...items.map((item) => field('li', item.material + ' · ' + item.color)));
    note.textContent = items.length ? '' : 'No filaments are listed as available yet.';
    note.hidden = Boolean(items.length);
  } catch {
    note.hidden = false;
    note.textContent = 'Could not load filaments. Use Refresh in the public queue to try again.';
  }
}
function projectCard(row) {
  const article = field('article', '', 'public-project');
  const heading = field('div', '', 'project-heading');
  const badge = field('span', '', 'badge');
  setBadge(badge, row.status);
  heading.append(field('h3', row.project), badge);
  const { total, ready, delivered } = row.progress;
  const active = row.status === 'in_process' || row.status === 'finished';
  const progress = active ? ' · ' + ready + ' ready for pickup · ' + delivered + ' of ' + total + ' delivered' : '';
  article.append(heading, field('p', 'Estimated ' + timeLabel(row.minutes) + progress, 'muted'));
  if (row.comment) article.append(field('p', row.comment, 'project-comment'));
  return article;
}
function setFilter(value) {
  filter = value;
  for (const button of document.querySelectorAll('[data-filter]')) {
    const active = button.dataset.filter === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
async function loadQueue() {
  const current = ++queueLoad;
  const note = $('queue-note');
  note.hidden = false;
  note.classList.remove('error');
  note.textContent = 'Loading projects…';
  $('queue-pages').hidden = true;
  try {
    const { items, more } = await call('queue?' + new URLSearchParams({ status: filter, page }));
    if (current !== queueLoad) return;
    if (!items.length && page > 0) { page--; return loadQueue(); }
    $('project-list').replaceChildren(...items.map(projectCard));
    note.textContent = items.length ? '' : 'No projects to show.';
    note.hidden = Boolean(items.length);
    $('queue-pages').hidden = !(page > 0 || more);
    $('queue-page').textContent = 'Page ' + (page + 1);
    $('queue-prev').disabled = page === 0;
    $('queue-next').disabled = !more;
  } catch (error) {
    if (current !== queueLoad) return;
    note.textContent = error.message;
    note.classList.add('error');
  }
}
for (const button of document.querySelectorAll('[data-filter]')) {
  button.addEventListener('click', () => { page = 0; setFilter(button.dataset.filter); void loadQueue(); });
}
$('queue-prev').addEventListener('click', () => { page--; void loadQueue(); });
$('queue-next').addEventListener('click', () => { page++; void loadQueue(); });
$('refresh-queue').addEventListener('click', () => { void loadQueue(); void loadFilaments(); });
if (location.hash === '#track' || location.hash.startsWith('#track=')) location.replace('#queue');
void loadQueue();
void loadFilaments();

