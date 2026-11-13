variable "instance_name" {
  description = "Nazwa instancji VM"
  type        = string
  default     = "ssh-vm"
}

variable "machine_type" {
  description = "Typ maszyny"
  type        = string
  default     = "e2-micro"
}

variable "ssh_user" {
  description = "Użytkownik SSH tworzony z klucza"
  type        = string
  default     = "debian"
}

variable "ssh_public_key_path" {
  description = "Ścieżka do publicznego klucza SSH"
  type        = string
  default     = "~/.ssh/ssh_key.pub"
}

variable "allowed_ssh_cidrs" {
  description = "Zakresy IP mogące łączyć się po SSH"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
