import * as vscode from "vscode";

import { IncrementNumberAction } from "./actions/commands/actions";
import { Position } from "./common/motion/position";
import { State } from "./mode/modeHandler";

const { Selection, Range } = vscode;

function nextLetterPosition(editor, pos, letter) {
  const line = editor.document.lineAt(pos);
  const remaining = line.text.substring(pos.character + 1);
  const index = remaining.indexOf(letter);
  if (index < 0) {
    return null;
  }
  return new Position(pos.line, pos.character + index + 1);
}

function forwardPosition(editor, pos, movement) {
  if (movement.count && movement.count > 1) {
    const next = forwardPosition(
      editor,
      pos,
      Object.assign({}, movement, {
        willRepeat: true,
        count: 1
      })
    );
    if (next.isEqual(pos)) {
      return pos;
    } else {
      const final = forwardPosition(
        editor,
        next,
        Object.assign({}, movement, { count: movement.count - 1 })
      );

      if (final.isEqual(next)) {
        return forwardPosition(
          editor,
          pos,
          Object.assign({}, movement, { count: 1 })
        );
      } else {
        return final;
      }
    }
  }
  if (movement.type === "letter") {
    return nextLetterPosition(editor, pos, movement.letter) || pos;
  } else if (movement.type === "line" && movement.modifier === "end") {
    const line = editor.document.lineAt(pos);
    return pos.with(undefined, line.text.length);
  } else if (movement.type === "afterLetter") {
    const next = nextLetterPosition(editor, pos, movement.letter);
    if (next) {
      return next.translate(0, movement.willRepeat ? 0 : 1);
    } else {
      return pos;
    }
  } else if (movement.type === "word") {
    const range = editor.document.getWordRangeAtPosition(pos);
    const line = editor.document.lineAt(pos).text;

    let wordEnd = range ? range.end : pos;

    // If we are repeating or not only selecting inside
    if (movement.willRepeat || !movement.inside) {
      while (wordEnd.character < line.length) {
        wordEnd = wordEnd.translate(0, 1);
        if (editor.document.getWordRangeAtPosition(wordEnd)) {
          break;
        }
      }
    }

    return wordEnd;
  } else {
    throw new Error(`Unknown movement: ${movement.type}`);
  }
}

function movementPosition(editor, movement) {
  const positions = editor.selections.map(s => s.active);
  return positions.map(pos => {
    return forwardPosition(editor, pos, movement);
  });
}

function movementRanges(editor, movement) {
  const positions = editor.selections.map(s => s.active);
  return positions.map(pos => {
    return new Range(pos, forwardPosition(editor, pos, movement));
  });
}

function movementSelections(editor, movement) {
  const positions = editor.selections.map(s => s.active);
  return editor.selections.map(sel => {
    return new Selection(
      sel.anchor,
      forwardPosition(editor, sel.active, movement)
    );
  });
}

const editorCommandHandlers = {
  async increment(editor) {
    const action: IncrementNumberAction = new IncrementNumberAction();

    const position = Position.FromVSCodePosition(
      vscode.window.activeTextEditor.selection.start
    );
    const state = new State();
    await action.exec(position, state);
  },
  move(editor, { movement }) {
    editor.selections = movementPosition(editor, movement).map(pos => {
      return new Selection(pos, pos);
    });
  },
  select(editor, { movement }) {
    editor.selections = movementSelections(editor, movement);
  },
  delete(editor, { movement }) {
    const selections = editor.selections;
    return editor
      .edit(edits => {
        for (let range of movementRanges(editor, movement)) {
          edits.delete(range);
        }
      })
      .then(() => {
        editor.selections = selections;
      });
  }
};

const commandHandlers = {
  commands({ commands }) {
    for (let command of commands) {
      console.log(command.command, command.args);
      vscode.commands.executeCommand(command.command, command.args || {});
    }
  }
};

Object.entries(editorCommandHandlers).forEach(([name, cb]) => {
  commandHandlers[name] = args => {
    if (vscode.window.activeTextEditor) {
      return cb(vscode.window.activeTextEditor, args);
    }
  };
});

exports.execute = function(commandArgs) {
  const args = commandArgs.arguments[0];
  console.log("OKAY");
  if (!commandHandlers.hasOwnProperty(args.command)) {
    vscode.window.showErrorMessage(`Unknown command: ${args.command}`);
    return;
  }
  try {
    commandHandlers[args.command](args);
  } catch (err) {
    vscode.window.showErrorMessage(err.toString());
    console.error(err.stack);
  }
};
