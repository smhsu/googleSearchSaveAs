function setFileInputElement(fileInput, file) {
    // To create a file: new File(["hello world"], "test.txt");
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change"));
}
