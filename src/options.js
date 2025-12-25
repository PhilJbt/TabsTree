document.addEventListener('DOMContentLoaded', () => {
  document.title = `Tabstree - ${chrome.i18n.getMessage('om_optionsandmanual')}`;
  document.querySelectorAll('*[data-i18n]').forEach(e => {
    e.innerText = chrome.i18n.getMessage(e.dataset.i18n);
  });

  const input = document.getElementById('defaultUrl');
  const status = document.getElementById('status');
  
  // Retrieve previously saved option
  chrome.storage.local.get(['options'], (result) => {
    const options = result.options || {};
    input.value = options.defaulturl || 'chrome://newtab';
  });
  
  // Auto save
  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => saveOption(input.value), 500);
  });
  
  function saveOption(url) {
    // URL validation
    try {
      new URL(url.startsWith('chrome://') || url.startsWith('about:') ? 'http://dummy' : url);
      status.textContent = chrome.i18n.getMessage('options_saved');
      status.className = 'status success';
    } catch {
      status.textContent = chrome.i18n.getMessage('options_saveerror');
      status.className = 'status error';
      return;
    }
    
    // Save
    chrome.storage.local.set({
      options: {
        defaulturl: url
      }
    }, () => {
      status.textContent = chrome.i18n.getMessage('options_saved');
      status.className = 'status success';
      status.classList.remove('flash');
      void status.offsetWidth;
      status.classList.add('flash');
    });
  }
});