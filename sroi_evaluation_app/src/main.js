import './style.css';
import { appState } from './app.js';

// Attach to window so inline HTML event listeners (onclick="appState.xxx") can access it
window.appState = appState;

document.addEventListener('DOMContentLoaded', () => {
    appState.init();
});