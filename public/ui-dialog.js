'use strict';

/**
 * Dialog konfirmasi/pemberitahuan/input untuk Agnee.
 *
 * Menggantikan window.confirm/alert/prompt bawaan browser: dialog OS tidak
 * bisa diberi gaya, tidak ikut bahasa yang dipilih user, dan memblokir thread.
 * Di sini dipakai elemen <dialog> yang digaya CSS aplikasi sendiri, sama
 * seperti .workspace-dialog di inbox.
 *
 * Semua fungsi mengembalikan Promise, jadi pemanggilnya harus async:
 *   if (!(await AgneeDialog.confirm({ ... }))) return;
 */
(() => {
  const tr = (key, fallback, vars) => {
    const translated = window.AgneeI18n?.t?.(key, vars);
    // t() mengembalikan key-nya sendiri kalau tidak ketemu; jangan tampilkan itu.
    return !translated || translated === key ? fallback : translated;
  };

  function build({ variant, title, message, preview, confirmLabel, cancelLabel, danger, input }) {
    const dialog = document.createElement('dialog');
    dialog.className = `ui-dialog${danger ? ' ui-dialog-danger' : ''}`;

    const head = document.createElement('header');
    const heading = document.createElement('h2');
    heading.textContent = title || tr('dialog.confirmTitle', 'Konfirmasi');
    head.append(heading);
    dialog.append(head);

    if (message) {
      const body = document.createElement('p');
      body.className = 'ui-dialog-message';
      body.textContent = message;
      dialog.append(body);
    }

    // Blok pratinjau: dipakai saat user perlu melihat teks persis yang akan
    // dikirim sebelum menyetujuinya.
    if (preview) {
      const pre = document.createElement('div');
      pre.className = 'ui-dialog-preview';
      pre.textContent = preview;
      dialog.append(pre);
    }

    let field = null;
    if (variant === 'prompt') {
      const label = document.createElement('label');
      label.className = 'ui-dialog-field';
      if (input?.label) {
        const span = document.createElement('span');
        span.textContent = input.label;
        label.append(span);
      }
      field = document.createElement(input?.multiline ? 'textarea' : 'input');
      if (input?.multiline) field.rows = input.rows || 4;
      field.value = input?.value || '';
      if (input?.placeholder) field.placeholder = input.placeholder;
      if (input?.maxLength) field.maxLength = input.maxLength;
      label.append(field);
      dialog.append(label);
    }

    const actions = document.createElement('div');
    actions.className = 'ui-dialog-actions';

    let cancelBtn = null;
    if (variant !== 'alert') {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ui-dialog-cancel';
      cancelBtn.textContent = cancelLabel || tr('dialog.cancel', 'Batal');
      actions.append(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = `ui-dialog-confirm${danger ? ' is-danger' : ''}`;
    okBtn.textContent = confirmLabel
      || (variant === 'alert' ? tr('dialog.ok', 'Mengerti') : tr('dialog.confirm', 'Ya, lanjutkan'));
    actions.append(okBtn);
    dialog.append(actions);

    return { dialog, okBtn, cancelBtn, field };
  }

  function open({ variant, resolveValue, ...options }) {
    return new Promise((resolve) => {
      const { dialog, okBtn, cancelBtn, field } = build({ variant, ...options });
      document.body.append(dialog);

      // Nilai kalau user membatalkan: null untuk prompt supaya bisa dibedakan
      // dari string kosong, false untuk confirm, undefined untuk alert.
      const cancelled = variant === 'prompt' ? null : variant === 'alert' ? undefined : false;

      // Tiap jalan keluar menyelesaikan promise-nya sendiri, dan `settled`
      // membuat pemanggilan berikutnya tidak berpengaruh.
      //
      // Kenapa tidak cukup satu handler 'close' saja: pada Chrome yang diuji
      // (152), dialog.close() mengubah .open dan .returnValue dengan benar
      // TAPI event 'close' tidak pernah menyala. Kalau resolusi digantungkan
      // ke event itu, dialog menutup tanpa promise-nya selesai — pemanggil
      // menggantung selamanya. Jadi 'cancel'/'close' hanya jaring pengaman.
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(value);
      };

      okBtn.addEventListener('click', () => finish(resolveValue(field)));
      cancelBtn?.addEventListener('click', () => finish(cancelled));
      // Klik di backdrop (di luar kotak dialog) membatalkan.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) finish(cancelled);
      });
      // Escape ditangani sendiri, tidak menunggu 'cancel'.
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(cancelled);
        } else if (event.key === 'Enter' && field && !options.input?.multiline) {
          event.preventDefault();
          finish(resolveValue(field));
        }
      });
      // Jaring pengaman kalau browser menutup dialog lewat jalurnya sendiri.
      dialog.addEventListener('cancel', () => finish(cancelled));
      dialog.addEventListener('close', () => finish(cancelled));

      dialog.showModal();
      if (field) { field.focus(); field.select?.(); } else okBtn.focus();
    });
  }

  window.AgneeDialog = {
    /** @returns {Promise<boolean>} */
    confirm(options = {}) {
      return open({ variant: 'confirm', ...options, resolveValue: () => true });
    },
    /** @returns {Promise<void>} */
    alert(options = {}) {
      return open({
        variant: 'alert',
        title: options.title || tr('dialog.errorTitle', 'Tidak berhasil'),
        ...options,
        resolveValue: () => undefined,
      });
    },
    /** @returns {Promise<string|null>} null kalau dibatalkan. */
    prompt(options = {}) {
      return open({ variant: 'prompt', ...options, resolveValue: (field) => field?.value ?? '' });
    },
    /** Jalur cepat untuk menampilkan pesan galat dari sebuah Error. */
    error(err, title) {
      return window.AgneeDialog.alert({
        title: title || tr('dialog.errorTitle', 'Tidak berhasil'),
        message: err?.message || String(err),
      });
    },
  };
})();
