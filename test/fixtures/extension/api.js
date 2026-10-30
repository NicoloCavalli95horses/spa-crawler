window.__TEST__init = () => { window.__testStarted = true; };
window.__TEST__getData = async (suffix = '') => ({ started: window.__testStarted === true, url: location.href + suffix });
