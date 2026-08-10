# T9 Keyboard for iOS — with a real backspace

The T9 keyboards on the App Store mostly nail the keypad but skip (or bury)
backspace, which makes them unusable for real typing. This project fixes that
in two pieces:

1. **`prototype/index.html`** — a browser prototype you can open on an iPhone
   to feel out the typing model before touching Xcode. It supports both
   classic multi-tap ("abc" mode) and predictive T9, and demonstrates the
   backspace behavior that matters:
   - **Tap** deletes one character — or, if you're mid multi-tap cycle,
     cancels the provisional character instead of eating the one before it.
   - **In predictive mode**, backspace pops the last *digit* of the word
     you're composing (so the candidate updates), and only starts deleting
     committed text once the composition is empty. This is the subtle case
     most implementations get wrong.
   - **Press and hold** auto-repeats the delete, accelerating after ~1.5s,
     just like the system keyboard.

2. **`ios/KeyboardViewController.swift`** — a complete, self-contained custom
   keyboard extension (multi-tap mode) implementing the same backspace model
   with `textDocumentProxy.deleteBackward()`, touch-down triggering, and
   timer-based accelerating auto-repeat.

## Running the Swift keyboard

Custom keyboards on iOS ship as app extensions, so you need a thin host app:

1. In Xcode: **File → New → Project → iOS App** (any name, e.g. `T9Host`).
2. **File → New → Target → Custom Keyboard Extension**. Name it `T9`.
3. Replace the generated `KeyboardViewController.swift` in the extension
   target with the one in `ios/`.
4. Run the *host app* target on your device, then enable the keyboard in
   **Settings → General → Keyboard → Keyboards → Add New Keyboard → T9**.
5. In any text field, hold the globe key and pick T9.

No "Full Access" permission is needed — the keyboard is fully offline and
never leaves the extension sandbox.

## Design notes

- Multi-tap commits a provisional character after 0.9s of inactivity, on a
  different-key press, or on space/return — same rules as the classic phones.
- Backspace fires on `touchDown` (not `touchUpInside`) so holding it starts
  deleting immediately; repeat kicks in after 0.5s at 10 chars/s and
  accelerates to 20 chars/s.
- The predictive dictionary in the prototype is a small embedded word list,
  ranked by frequency. The Swift port of predictive mode would reuse the same
  digit-sequence → prefix-trie approach; multi-tap ships first because it
  needs no dictionary and is fully predictable.
