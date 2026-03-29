'use strict';

(function initPopupTemplates(root) {
  function renderNetworkPicker(context, config) {
    const {
      defaultNetworkKey,
      networkKeys,
      networks,
      optionResolver,
    } = config;

    const picker = document.getElementById(`network-picker-${context}`);
    if (!picker) return;

    const defaultOption = optionResolver(defaultNetworkKey);
    picker.textContent = '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'network-picker-trigger';
    trigger.setAttribute('data-onclick', `toggleNetworkPicker('${context}', event)`);

    const left = document.createElement('span');
    left.className = 'network-picker-left';

    const mark = document.createElement('span');
    mark.className = 'network-picker-mark';
    mark.id = `network-picker-mark-${context}`;
    mark.textContent = defaultOption.mark;

    const label = document.createElement('span');
    label.className = 'network-picker-label';
    label.id = `network-picker-label-${context}`;
    label.textContent = defaultOption.label;

    const caret = document.createElement('span');
    caret.className = 'network-picker-caret';
    caret.setAttribute('aria-hidden', 'true');

    left.appendChild(mark);
    left.appendChild(label);
    trigger.appendChild(left);
    trigger.appendChild(caret);

    const menu = document.createElement('div');
    menu.className = 'network-picker-menu';

    networkKeys
      .filter((networkKey) => !!networks[networkKey])
      .forEach((networkKey) => {
        const optionData = optionResolver(networkKey);
        const networkMeta = networks[networkKey];

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'network-option';
        button.dataset.networkOption = networkKey;
        button.setAttribute('data-onclick', `selectNetworkOption('${context}', '${networkKey}', event)`);

        const main = document.createElement('span');
        main.className = 'network-option-main';

        const optionMark = document.createElement('span');
        optionMark.className = 'network-picker-mark';
        optionMark.textContent = optionData.mark;

        const optionLabel = document.createElement('span');
        optionLabel.textContent = optionData.label;

        const sub = document.createElement('span');
        sub.className = 'network-option-sub';
        sub.textContent = networkMeta.isTestnet ? 'Testnet' : 'Mainnet';

        main.appendChild(optionMark);
        main.appendChild(optionLabel);
        button.appendChild(main);
        button.appendChild(sub);
        menu.appendChild(button);
      });

    picker.appendChild(trigger);
    picker.appendChild(menu);
  }

  function renderNetworkPickers(config) {
    const contexts = Array.isArray(config.contexts) ? config.contexts : [];
    contexts.forEach((context) => renderNetworkPicker(context, config));
  }

  function renderFeedbackMounts() {
    document.querySelectorAll('.feedback-mount').forEach((mount) => {
      const prefix = (mount.dataset.feedbackPrefix || '').trim();
      if (!prefix) return;

      const types = String(mount.dataset.feedbackTypes || 'error,status')
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean);

      mount.textContent = '';
      types.forEach((type) => {
        const el = document.createElement('div');
        el.className = type;
        el.id = `${prefix}-${type}`;
        mount.appendChild(el);
      });
    });
  }

  root.WolfPopupTemplates = {
    renderFeedbackMounts,
    renderNetworkPickers,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
