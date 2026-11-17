// Stand-in for Phenom's apply form script (its apply form renderer bundle), which page captures leave out. It does
// what that bundle does on the parts the runner touches, with schema settings common.alertType "browser",
// cloudWidget.commonCloudOptions.showErrorAsAlert true and fileUploadOptional false:
// - The résumé upload (react-dropzone's hidden file input): the loader shows, then alert("Your resume has been
//   uploaded successfully.") (customAlert, alertType "browser"), then setResumeData writes resumeRelativePath,
//   resumeName and isResume into the store's form data (rendered into the hidden inputs) and the loader hides.
// - Every field change reaches the store through a 200 ms debounced setFormData that carries the form data as it
//   was at that change (onChange -> a useDebouncedCallback of 200 ms). A change made while the upload is in flight
//   writes the form data back without the résumé when its debounce fires after the upload landed.
// - Next: required fields first (the "Please enter all required fields:" list), then the résumé check: no
//   resumeRelativePath in the form data -> alert("Resume Import is mandatory, Please use any one of the resume
//   upload options.") and a scroll to the top, nothing sent; else the next step ("My experience") is current.
// window.PHENOM = { uploadMs, debounceMs } overrides the timings.
(() => {
  const cfg = Object.assign({ uploadMs: 600, debounceMs: 200 }, window.PHENOM || {});
  const RESUME = ['resumeRelativePath', 'resumeName', 'isResume'];
  let data = {};
  // The schema's defaults, which Phenom renders on load: country "USA" and its phone code.
  document.getElementById('country').value = 'USA';
  document.getElementById('phoneWidget.countryPhoneCode').value = 'USA_1';
  const render = () => { for (const k of RESUME) { const el = document.getElementById(k); if (el) el.value = data[k] || ''; } };
  const loader = (on) => document.querySelectorAll('.overlaybg, .widget-loader').forEach((e) => e.classList.toggle('hidden', !on));
  const file = document.querySelector('.resume-upload-wrapper input[type="file"]');
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    loader(true);
    setTimeout(() => {
      alert('Your resume has been uploaded successfully.');
      data = { ...data, resumeRelativePath: `/tenant/resumes/${f.name}`, resumeName: f.name, isResume: 'true' };
      render();
      loader(false);
      const shown = document.createElement('div');
      shown.className = 'uploaded-file';
      shown.innerHTML = `<span class="file-name"></span> <a href="#">Download</a>`;
      shown.querySelector('.file-name').textContent = f.name;
      document.querySelector('.resume-section').after(shown);
    }, cfg.uploadMs);
  });
  const form = document.querySelector('form.rjsf');
  let timer = null;
  const onChange = () => {
    const at = Object.fromEntries(RESUME.map((k) => [k, data[k]]));
    clearTimeout(timer);
    timer = setTimeout(() => { data = { ...data, ...at }; render(); }, cfg.debounceMs);
  };
  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);
  const shownEl = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const empty = (el) => (el.type === 'checkbox' ? !el.checked : el.tagName === 'SELECT' ? el.selectedIndex <= 0 : !el.value.trim());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    document.querySelectorAll('.error-list').forEach((x) => x.remove());
    const missing = [...form.querySelectorAll('input[required], select[required]')].filter((el) => (shownEl(el) || (el.closest('label') && shownEl(el.closest('label')))) && empty(el)).length
      + [...form.querySelectorAll('[role="radiogroup"][aria-required="true"]')].filter((g) => !g.querySelector('input:checked')).length;
    if (missing) {
      const list = document.createElement('div');
      list.className = 'error-list';
      list.innerHTML = `<p>Please enter all required fields:</p><ul>${'<li>This field is required.</li>'.repeat(missing)}</ul>`;
      form.prepend(list);
      window.scrollTo(0, 0);
      return;
    }
    if (!data.resumeRelativePath) {
      alert('Resume Import is mandatory, Please use any one of the resume upload options.');
      window.scrollTo(0, 0);
      return;
    }
    const root = document.querySelector('.external-job');
    root.className = root.className.replace(/current-step-\S+/, 'current-step-workAndEducation');
    for (const li of document.querySelectorAll('li[atm-id]')) {
      if (li.getAttribute('atm-id') === 'workAndEducation') li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    }
    form.innerHTML = '<div class="markdown"><p>My experience</p></div><div class="navigation workAndEducation-step"><button type="submit" class="btn btn-navigate btn-next" id="next" aria-label="Next">Next</button></div>';
    window.scrollTo(0, 0);
  });
})();
