/**
 * Open a file from anywhere in the app - a dialog that is not inside a view,
 * say - the way the tree opens it. The shell sets the opener.
 */

let opener: (path: string) => void = () => {}

export function setFileOpener(open: (path: string) => void): void {
  opener = open
}

export const openFileFromAnywhere = (path: string): void => opener(path)
