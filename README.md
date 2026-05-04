# Dyad (focusthitipan fork)

This is a personal fork of [dyad-sh/dyad](https://github.com/dyad-sh/dyad) with the following customizations:

### UI / UX
- Removed Dyad Pro / server-dependent UI (onboarding banner, free trial card)
- Removed the `auto` (Dyad Pro) provider from the model picker
- Default model changed to `gemini-2.5-flash-preview` (Google)
- Release channel selector now correctly routes the auto-updater to stable or beta GitHub releases from this fork

### Dyad Pro feature gating
- Centralized all Dyad Pro feature checks using the `isDyadProEnabled` utility across TitleBar, ModelPicker, ChatInput, TokenBar, PreviewIframe, and IPC handlers
- Re-enabled Pro bypass so local Pro features work without a subscription
- Removed unused Dyad Pro model constants and cloud client code (~500 lines)

### Cross-platform stability
- Normalized path handling for Windows (drive-letter / UNC path detection, no false positives on POSIX paths containing backslash)
- Fixed symlink edge cases during recursive copy: skip symlinked directories to prevent cycles, follow symlink-to-file entries, and handle broken symlinks gracefully
- Stabilized Windows-specific assertions in the unit-test suite

---

Dyad is a local, open-source AI app builder. It's fast, private, and fully under your control — like Lovable, v0, or Bolt, but running right on your machine.

More info about the original project: [https://dyad.sh/](https://dyad.sh/)

## 🚀 Features

- ⚡️ **Local**: Fast, private and no lock-in.
- 🛠 **Bring your own keys**: Use your own AI API keys — no vendor lock-in.
- 🖥️ **Cross-platform**: Easy to run on Mac or Windows.

## 📦 Download

No sign-up required. Just download and go.

Releases for this fork: [https://github.com/focusthitipan/dyad/releases](https://github.com/focusthitipan/dyad/releases)

## 🛠️ Contributing

**Dyad** is open-source (see License info below).

If you're interested in contributing to the upstream project, please read their [contributing](./CONTRIBUTING.md) doc.

## License

- All the code in this repo outside of `src/pro` is open-source and licensed under Apache 2.0 - see [LICENSE](./LICENSE).
- All the code in this repo within `src/pro` is fair-source and licensed under [Functional Source License 1.1 Apache 2.0](https://fsl.software/) - see [LICENSE](./src/pro/LICENSE).
