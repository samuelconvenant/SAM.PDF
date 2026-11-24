declare module "pdfmake/build/pdfmake" {
  const pdfmake: {
    addVirtualFileSystem(files: Record<string, string>): void;
    addFontContainer(container: object): void;
    addFonts(fonts: Record<string, Record<string, string>>): void;
    createPdf(definition: object): { getBlob(): Promise<Blob> };
  };
  export default pdfmake;
}
declare module "pdfmake/build/standard-fonts/Times" {
  const container: object;
  export default container;
}
declare module "pdfmake/build/standard-fonts/Courier" {
  const container: object;
  export default container;
}
declare module "pdfmake/build/standard-fonts/Helvetica" {
  const container: object;
  export default container;
}
declare module "pdfmake/build/vfs_fonts" {
  const files: Record<string, string>;
  export default files;
}
