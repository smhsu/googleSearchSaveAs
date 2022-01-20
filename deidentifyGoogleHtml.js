/**
 * 1. Remove all <script> nodes with '@' symbols in them, assuming they contain email addresses.
 * 2. Delete any nodes with the `aria-label` beginning with `Account Information` (selector: `[aria-label~='Account Information']`)
 * 3. Delete any nodes with the `aria-label` beginning with `Google Account` (selector: `[aria-label~='Google Account']`)
 * 4. Delete any nodes and their siblings when the text says "Google Account"
 * 
 * @param {string} htmlString 
 * @return {string} deidentified html
 */
function deidentifyGoogleHtml(htmlString) {
    /** @param {HTMLCollection} nodes */
    function removeNodes(nodes) {
        for (const node of nodes) {
            node.remove();
        }
    }

    const dom = new DOMParser().parseFromString(htmlString, "text/html");
    deidentifyScripts(dom);
    removeNodes(dom.querySelectorAll("[aria-label^='Account Information']"));
    removeNodes(dom.querySelectorAll("[aria-label^='Google Account']"));

    const nodesToRemove = new Set();
    for (const node of dom.getElementsByTagName("*")) {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && child.nodeValue === "Google Account") {
                nodesToRemove.add(node.parentNode); // Delete all sibilings of this node.
            }
        }
    }
    removeNodes(nodesToRemove);

    return new XMLSerializer().serializeToString(dom);
}

/** @param {Document} dom */
function deidentifyScripts(dom) {
    let numIterations = 0;
    let numScriptsRemoved = 0;

    do { // For some reason, when removing a script, they still remain.  But repeated removals work.
        numScriptsRemoved = 0;
        for (const script of dom.scripts) {
            if (script.innerText.includes("@")) { // Assume a script with an '@' symbol includes an email address.
                script.remove();
                numScriptsRemoved++;
            }
        }
        numIterations++;
    } while (dom.scripts.length > 0 && numIterations < 5 && numScriptsRemoved > 0)
}
