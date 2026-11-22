const localTools = [
  { id: "merge", name: "Merge PDF", category: "Organize", tone: "blue", description: "Combine multiple PDFs into one document, in the order you choose.", accept: ".pdf,application/pdf", multiple: true, action: "Merge PDFs", input: "Choose two or more PDFs to combine." },
  { id: "split", name: "Split PDF", category: "Organize", tone: "lavender", description: "Extract a page range or split a document into separate PDFs.", accept: ".pdf,application/pdf", multiple: false, action: "Split PDF", input: "Choose a PDF, then enter the page ranges to extract." },
  { id: "organize", name: "Organize PDF", category: "Organize", tone: "green", description: "Reorder, rotate, or remove pages to put your document in shape.", accept: ".pdf,application/pdf", multiple: false, action: "Save PDF", input: "Choose a PDF to rearrange its pages." },
  { id: "edit", name: "Edit PDF", category: "Edit", tone: "gold", description: "Add text boxes and photos to an existing PDF.", accept: ".pdf,application/pdf", multiple: false, action: "Preview edited PDF", input: "Choose an existing PDF to add text boxes or images." },
  { id: "images-to-pdf", name: "Images to PDF", category: "Convert", tone: "peach", description: "Turn JPG and PNG images into a single, neatly ordered PDF.", accept: ".jpg,.jpeg,.png,image/jpeg,image/png", multiple: true, action: "Create PDF", input: "Choose JPEG or PNG images to turn into a PDF." },
] as const;

export const wordTools = [
  { id: "pdf-to-word", name: "PDF to Word", category: "Convert", description: "Convert a PDF into an editable Word document." },
  { id: "word-to-pdf", name: "Word to PDF", category: "Convert", description: "Convert a Word document to a shareable PDF." },
] as const;

const createTool = { id: "create", name: "Create PDF", category: "Create", description: "Start with a blank A4 page. Write and format a document with tables and pictures." } as const;
export const tools = [...localTools, createTool, ...wordTools] as const;
export type Tool = (typeof tools)[number];
export type LocalTool = (typeof localTools)[number];
export type Operation = LocalTool["id"];
export const maxFiles = 30;
export const maxBytes = 80 * 1024 * 1024;

export function getTool(id: string) {
  return tools.find((tool) => tool.id === id);
}
