# Plan: mała VM w GCP dostępna wyłącznie przez SSH (port 22)

## Cel

Rozszerzyć istniejący Terraform w `Infrastructure/` o:

- małą VM (`e2-micro`) w strefie `us-central1-c`,
- logowanie **wyłącznie kluczem SSH** (bez haseł, bez kluczy projektowych),
- ruch przychodzący do VM **zablokowany poza TCP/22**.

## Stan wyjściowy (zweryfikowany)

- `Infrastructure/main.tf`: provider `google` 6.8.0, projekt `liquid-streamer-284510`, region `us-central1`, strefa `us-central1-c`, VPC `main-network`, backend GCS `infrastructure-ai-pm`.
- Brak subnetu, firewalla, VM, zmiennych i outputów.
- Klucz publiczny użytkownika: `~/.ssh/ssh_key.pub`.
- `.gitignore` ignoruje `*.tfvars` i `.terraform/`.
- `google_compute_network.vpc_network` nie ma ustawionego `auto_create_subnetworks` (domyślnie `true`) — **nie zmieniać tego zasobu**, żeby uniknąć odtworzenia sieci.

## Decyzje projektowe

1. **VM**: `e2-micro`, Debian 12 (`debian-cloud/debian-12`), dysk 10 GB `pd-balanced`, efemeryczny zewnętrzny IP (`access_config {}`). Strefa `us-central1-c`.
2. **Sieć**: dodać nowy `google_compute_subnetwork` w `us-central1` (CIDR `10.10.0.0/24`) podpięty pod istniejący `main-network`. Nie ruszać VPC.
3. **Firewall** (tylko ingress; egress zostaje domyślny, potrzebny m.in. na aktualizacje):
   - allow TCP/22, priorytet 1000, tag `ssh`,
   - jawne deny-all ingress, priorytet 65534, tag `ssh` (dokumentuje intencję; i tak obowiązuje implied deny).
4. **SSH**: klucz w metadanych instancji `ssh-keys = "<user>:<klucz>"`, `enable-oslogin = "FALSE"` (nadpisuje ewentualny OS Login na poziomie projektu), `block-project-ssh-keys = "TRUE"`. Debian ma domyślnie `PasswordAuthentication no`, więc hasła są wyłączone.
5. **Uprawnienia VM**: dedykowane konto serwisowe `vm-ssh` bez ról IAM, scope tylko `logging-write`, `monitoring-write`. Nie używać domyślnego SA compute.
6. **Klucz SSH**: ścieżka do klucza publicznego jako zmienna (`~/.ssh/ssh_key.pub`), użytkownik `debian`.
7. **Zakres źródłowy SSH**: zmienna `allowed_ssh_cidrs`, domyślnie `["0.0.0.0/0"]`; można zawęzić do własnego IP bez zmian w kodzie.

## Zadania implementacyjne (kolejność)

### 1. `Infrastructure/main.tf` — dopisz subnet

Na końcu pliku dodaj:

```hcl
resource "google_compute_subnetwork" "main" {
  name          = "main-subnet-us-central1"
  network       = google_compute_network.vpc_network.id
  region        = "us-central1"
  ip_cidr_range = "10.10.0.0/24"
}
```

### 2. `Infrastructure/variables.tf` — nowy plik

```hcl
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
```

### 3. `Infrastructure/firewall.tf` — nowy plik

```hcl
resource "google_compute_firewall" "allow_ssh" {
  name          = "${var.instance_name}-allow-ssh"
  network       = google_compute_network.vpc_network.name
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = var.allowed_ssh_cidrs
  target_tags   = ["ssh"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "deny_all_ingress" {
  name          = "${var.instance_name}-deny-all-ingress"
  network       = google_compute_network.vpc_network.name
  direction     = "INGRESS"
  priority      = 65534
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["ssh"]

  deny {
    protocol = "all"
  }
}
```

### 4. `Infrastructure/compute.tf` — nowy plik

```hcl
resource "google_service_account" "vm" {
  account_id   = "vm-ssh"
  display_name = "VM SSH access"
}

resource "google_compute_instance" "vm" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = "us-central1-c"
  tags         = ["ssh"]
  labels       = { purpose = "ssh" }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-balanced"
    }
  }

  network_interface {
    network    = google_compute_network.vpc_network.id
    subnetwork = google_compute_subnetwork.main.id
    access_config {}
  }

  metadata = {
    enable-oslogin         = "FALSE"
    block-project-ssh-keys = "TRUE"
    ssh-keys               = "${var.ssh_user}:${trimspace(file(pathexpand(var.ssh_public_key_path)))}"
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["logging-write", "monitoring-write"]
  }

  allow_stopping_for_update = true
  deletion_protection       = false
}
```

### 5. `Infrastructure/outputs.tf` — nowy plik

```hcl
output "instance_name" {
  value = google_compute_instance.vm.name
}

output "instance_external_ip" {
  value = google_compute_instance.vm.network_interface[0].access_config[0].nat_ip
}

output "ssh_command" {
  value = "ssh -i ${trimsuffix(var.ssh_public_key_path, ".pub")} ${var.ssh_user}@${google_compute_instance.vm.network_interface[0].access_config[0].nat_ip}"
}
```

### 6. `Infrastructure/terraform.tfvars.example` — nowy plik (opcjonalny, wersjonowany)

```hcl
# Skopiuj do terraform.tfvars (ignorowany przez git) i dostosuj.
# ssh_public_key_path = "~/.ssh/ssh_key.pub"
# ssh_user            = "debian"
# allowed_ssh_cidrs   = ["203.0.113.10/32"]
```

## Walidacja

1. `terraform fmt -check -recursive` — poprawność formatowania.
2. `terraform init` — dociągnięcie providera i backendu GCS (wymaga auth do projektu).
3. `terraform validate` — poprawność składni i referencji.
4. `terraform plan` — **oczekiwane wyłącznie dodatki**: subnetwork, 2 firewalle, SA, instancja. Brak zmian/destrukcji `vpc_network`.
5. `terraform apply`.
6. Smoke test:
   - `ssh -i ~/.ssh/ssh_key -o IdentitiesOnly=yes debian@$(terraform output -raw instance_external_ip)` — logowanie kluczem działa,
   - `nc -zv <IP> 22` — otwarte,
   - `nc -zv <IP> 80` oraz `nc -zv <IP> 443` — zamknięte/filtrowane,
   - `gcloud compute firewall-rules list --filter="network=main-network"` — widoczne tylko reguły 22 + deny-all ingress.
7. Test negatywny hasła: `ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no debian@<IP>` — odrzucone.

## Ryzyka i uwagi

- **Polityka org ograniczająca external IP**: `apply` może się nie udać. Fallback: usunąć `access_config`, dodać firewall na `35.235.240.0/20` i łączyć się przez `gcloud compute ssh --tunnel-through-iap`. Wymaga to jednak uprawnień IAP; obecny plan zakłada bezpośredni SSH.
- **Zmiana `auto_create_subnetworks` w istniejącym VPC** wymusiłaby odtworzenie sieci — świadomie pomijamy.
- **Efemeryczny IP** zmienia się po stop/start; output `ssh_command` trzeba odświeżyć (`terraform output`). Opcjonalnie można później dodać `google_compute_address` (statyczny IP).
- **Koszt**: `e2-micro` w `us-central1` jest w darmowym tierze (1 instancja); dysk 10 GB może generować minimalny koszt.
- Jeśli `~/.ssh/ssh_key.pub` nie istnieje, `file()` zwróci błąd — wtedy ustawić `ssh_public_key_path` w `terraform.tfvars`.
- Nie commitować `terraform.tfvars` ani prywatnego klucza (`.gitignore` już to pokrywa).

## Poza zakresem

- Ograniczanie egressu VM (wymaganie dotyczy ruchu *do* VM).
- Statyczny IP, IAP-only SSH, hardening sshd przez startup script.
- Zmiana projektu/regionu/strefy providera.
