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
