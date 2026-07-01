export interface Folder {
  id: string
  name: string
  color: string | null
  parentId: string | null
  createdAt: string
  updatedAt: string
  fileCount: number
}

export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[]
  totalFileCount: number
}

export interface FolderBreadcrumbItem {
  id: string
  name: string
}
