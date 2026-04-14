'use strict';

export const WolfPopupStorage = {
  getLocal(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },
  setLocal(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  },
  removeLocal(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
  },
  getSession(keys) {
    return new Promise((resolve) => chrome.storage.session.get(keys, resolve));
  },
  setSession(data) {
    return new Promise((resolve) => chrome.storage.session.set(data, resolve));
  },
};
globalThis.WolfPopupStorage = WolfPopupStorage;
