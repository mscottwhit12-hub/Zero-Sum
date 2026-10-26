import { mount } from 'svelte';
import '@shared/base.css';
import App from './App.svelte';

document.documentElement.dataset.theme = 'dark';
mount(App, { target: document.getElementById('app')! });
