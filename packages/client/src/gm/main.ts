import { mount } from 'svelte';
import '@shared/base.css';
import './gm.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
