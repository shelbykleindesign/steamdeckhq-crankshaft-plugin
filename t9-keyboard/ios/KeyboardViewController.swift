import UIKit

/// A T9-style (multi-tap) custom keyboard for iOS with a first-class backspace:
/// - single tap deletes one character (or cancels an in-progress multi-tap cycle)
/// - press-and-hold auto-repeats the delete, accelerating the longer you hold
///
/// Drop this into a Custom Keyboard Extension target (see README.md).
class KeyboardViewController: UIInputViewController {

    // MARK: - Multi-tap state

    private let keyMap: [String: String] = [
        "1": ".,?!'",
        "2": "abc",
        "3": "def",
        "4": "ghi",
        "5": "jkl",
        "6": "mno",
        "7": "pqrs",
        "8": "tuv",
        "9": "wxyz",
    ]

    /// The digit key currently being cycled, if any.
    private var pendingKey: String?
    /// Index into that key's character cycle.
    private var pendingIndex = 0
    /// Commits the pending character after a pause, like the classic phones did.
    private var commitTimer: Timer?
    private let commitDelay: TimeInterval = 0.9

    private enum ShiftState { case off, next, locked }
    private var shiftState: ShiftState = .off {
        didSet { updateShiftAppearance() }
    }

    // MARK: - Backspace repeat state

    private var backspaceTimer: Timer?
    private var backspaceRepeats = 0

    // MARK: - Views

    private var shiftButton: UIButton?
    private var backspaceButton: UIButton?

    override func viewDidLoad() {
        super.viewDidLoad()
        buildKeyboard()
        addSwipeGestures()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        commitPending()
        stopBackspaceRepeat()
    }

    // MARK: - Layout

    private func buildKeyboard() {
        let rows = UIStackView()
        rows.axis = .vertical
        rows.distribution = .fillEqually
        rows.spacing = 6
        rows.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(rows)

        NSLayoutConstraint.activate([
            rows.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
            rows.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
            rows.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            rows.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
            rows.heightAnchor.constraint(equalToConstant: 5 * 46 + 4 * 6),
        ])

        for digits in [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]] {
            let row = makeRow()
            for digit in digits {
                row.addArrangedSubview(makeDigitKey(digit))
            }
            rows.addArrangedSubview(row)
        }

        let fourthRow = makeRow()
        let shift = makeSpecialKey(title: "⇧", action: #selector(shiftTapped))
        shiftButton = shift
        fourthRow.addArrangedSubview(shift)
        fourthRow.addArrangedSubview(makeSpecialKey(title: "space", action: #selector(spaceTapped)))
        fourthRow.addArrangedSubview(makeBackspaceKey())
        rows.addArrangedSubview(fourthRow)

        let bottomRow = makeRow()
        if needsInputModeSwitchKey {
            let globe = makeSpecialKey(title: "🌐", action: nil)
            globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
            bottomRow.addArrangedSubview(globe)
        }
        bottomRow.addArrangedSubview(makeSpecialKey(title: "return", action: #selector(returnTapped)))
        rows.addArrangedSubview(bottomRow)
    }

    private func makeRow() -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.spacing = 6
        return row
    }

    private func makeKeyBase() -> UIButton {
        let button = UIButton(type: .system)
        button.layer.cornerRadius = 8
        button.backgroundColor = .systemBackground
        button.setTitleColor(.label, for: .normal)
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.25
        button.layer.shadowOffset = CGSize(width: 0, height: 1)
        button.layer.shadowRadius = 0
        return button
    }

    private func makeDigitKey(_ digit: String) -> UIButton {
        let button = makeKeyBase()
        let letters = keyMap[digit] ?? ""
        var config = UIButton.Configuration.plain()
        config.attributedTitle = AttributedString(
            digit, attributes: AttributeContainer([.font: UIFont.systemFont(ofSize: 22, weight: .medium)]))
        config.attributedSubtitle = AttributedString(
            digit == "1" ? letters : letters.uppercased(),
            attributes: AttributeContainer([
                .font: UIFont.systemFont(ofSize: 11, weight: .regular),
                .foregroundColor: UIColor.secondaryLabel,
            ]))
        config.titleAlignment = .center
        button.configuration = config
        button.accessibilityLabel = "\(digit), \(letters)"
        button.addAction(UIAction { [weak self] _ in self?.digitTapped(digit) }, for: .touchUpInside)
        return button
    }

    private func makeSpecialKey(title: String, action: Selector?) -> UIButton {
        let button = makeKeyBase()
        button.backgroundColor = .secondarySystemBackground
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        if let action { button.addTarget(self, action: action, for: .touchUpInside) }
        return button
    }

    // MARK: - Backspace (the part the app-store T9 keyboards forgot)

    private func makeBackspaceKey() -> UIButton {
        let button = makeKeyBase()
        backspaceButton = button
        button.backgroundColor = .secondarySystemBackground
        button.setTitle("⌫", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 20, weight: .medium)
        button.accessibilityLabel = "delete"
        // touchDown (not touchUpInside) so held keys start deleting immediately,
        // matching the system keyboard's feel.
        button.addTarget(self, action: #selector(backspaceDown), for: .touchDown)
        button.addTarget(self, action: #selector(backspaceUp), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
        return button
    }

    @objc private func backspaceDown() {
        deleteOnce()
        backspaceRepeats = 0
        backspaceTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
            self?.startBackspaceRepeat(interval: 0.1)
        }
    }

    private func startBackspaceRepeat(interval: TimeInterval) {
        backspaceTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.deleteOnce()
            self.backspaceRepeats += 1
            // Accelerate after ~1.5s of held deleting.
            if self.backspaceRepeats == 15 {
                self.backspaceTimer?.invalidate()
                self.startBackspaceRepeat(interval: 0.05)
            }
        }
    }

    @objc private func backspaceUp() {
        stopBackspaceRepeat()
    }

    private func stopBackspaceRepeat() {
        backspaceTimer?.invalidate()
        backspaceTimer = nil
        backspaceRepeats = 0
    }

    private func deleteOnce() {
        if pendingKey != nil {
            // Mid multi-tap cycle: the provisional character is the thing on
            // screen, so deleting cancels the cycle rather than eating the
            // character before it.
            cancelPending()
        }
        textDocumentProxy.deleteBackward()
        UIDevice.current.playInputClick()
    }

    // MARK: - Multi-tap typing

    private func digitTapped(_ digit: String) {
        guard let letters = keyMap[digit] else { return }
        commitTimer?.invalidate()

        if pendingKey == digit {
            // Same key again: replace the provisional character with the next
            // one in the cycle.
            pendingIndex = (pendingIndex + 1) % letters.count
            textDocumentProxy.deleteBackward()
        } else {
            // Different key: whatever is on screen becomes final.
            commitPending()
            pendingKey = digit
            pendingIndex = 0
        }

        let character = String(letters[letters.index(letters.startIndex, offsetBy: pendingIndex)])
        textDocumentProxy.insertText(applyShift(to: character))
        UIDevice.current.playInputClick()

        commitTimer = Timer.scheduledTimer(withTimeInterval: commitDelay, repeats: false) { [weak self] _ in
            self?.commitPending()
        }
    }

    /// The provisional character is already in the document; committing just
    /// means forgetting the cycle state (and consuming a one-shot shift).
    private func commitPending() {
        commitTimer?.invalidate()
        commitTimer = nil
        if pendingKey != nil, shiftState == .next {
            shiftState = .off
        }
        pendingKey = nil
        pendingIndex = 0
    }

    private func cancelPending() {
        commitTimer?.invalidate()
        commitTimer = nil
        pendingKey = nil
        pendingIndex = 0
    }

    private func applyShift(to character: String) -> String {
        switch shiftState {
        case .off: return character
        case .next, .locked: return character.uppercased()
        }
    }

    // MARK: - Other keys

    @objc private func shiftTapped() {
        switch shiftState {
        case .off: shiftState = .next
        case .next: shiftState = .locked
        case .locked: shiftState = .off
        }
    }

    private func updateShiftAppearance() {
        switch shiftState {
        case .off:
            shiftButton?.setTitle("⇧", for: .normal)
            shiftButton?.backgroundColor = .secondarySystemBackground
        case .next:
            shiftButton?.setTitle("⇧", for: .normal)
            shiftButton?.backgroundColor = .systemBackground
        case .locked:
            shiftButton?.setTitle("⇪", for: .normal)
            shiftButton?.backgroundColor = .systemBackground
        }
    }

    @objc private func spaceTapped() {
        commitPending()
        textDocumentProxy.insertText(" ")
        UIDevice.current.playInputClick()
    }

    @objc private func returnTapped() {
        commitPending()
        textDocumentProxy.insertText("\n")
        UIDevice.current.playInputClick()
    }

    // MARK: - Swipe gestures

    /// Left: delete word · right: space · up: shift · down: dismiss keyboard.
    /// Swipes may start on any key except backspace (see gesture delegate) —
    /// recognition cancels the underlying button touch, so a swipe never
    /// also types.
    private func addSwipeGestures() {
        let gestures: [(UISwipeGestureRecognizer.Direction, Selector)] = [
            (.left, #selector(swipedLeft)),
            (.right, #selector(swipedRight)),
            (.up, #selector(swipedUp)),
            (.down, #selector(swipedDown)),
        ]
        for (direction, selector) in gestures {
            let swipe = UISwipeGestureRecognizer(target: self, action: selector)
            swipe.direction = direction
            swipe.delegate = self
            view.addGestureRecognizer(swipe)
        }
    }

    @objc private func swipedLeft() { deleteWordBackward() }

    @objc private func swipedRight() { spaceTapped() }

    @objc private func swipedUp() { shiftTapped() }

    @objc private func swipedDown() {
        commitPending()
        dismissKeyboard()
    }

    private func deleteWordBackward() {
        // Mid multi-tap cycle: the swipe means "kill the word", and the
        // provisional character is part of it.
        cancelPending()
        guard var context = textDocumentProxy.documentContextBeforeInput,
              !context.isEmpty else {
            textDocumentProxy.deleteBackward()
            UIDevice.current.playInputClick()
            return
        }
        var count = 0
        while let last = context.last, last == " " || last == "\n" {
            context.removeLast()
            count += 1
        }
        while let last = context.last, last != " ", last != "\n" {
            context.removeLast()
            count += 1
        }
        for _ in 0..<max(count, 1) {
            textDocumentProxy.deleteBackward()
        }
        UIDevice.current.playInputClick()
    }
}

extension KeyboardViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldReceive touch: UITouch) -> Bool {
        // Backspace acts on touch-down for instant hold-to-repeat, so it
        // can't also be the start of a swipe.
        guard let backspace = backspaceButton, let touched = touch.view else { return true }
        return !touched.isDescendant(of: backspace)
    }
}

extension KeyboardViewController: UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}
