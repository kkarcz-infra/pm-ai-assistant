# gcp-ssh.sh

Skrypt do logowania SSH na VM-ki w Google Cloud oraz do ich uruchamiania i zatrzymywania. Bez parametrów wyświetla krótką pomoc; gdy podasz samą opcję (np. `--stop`), skrypt wyświetla numerowaną listę instancji w aktywnym projekcie i pyta, którą wybrać. `--list` wypisuje dostępne VM-ki i kończy działanie. Logowanie nie uruchamia VM automatycznie — do tego służy `--start`.

Domyślny klucz prywatny: `~/.ssh/ssh_key`.

## Wymagania

- Zainstalowany i skonfigurowany `gcloud` (`gcloud auth login`).
- Ustawiony projekt (`gcloud config set project TWOJ_PROJEKT`) albo zmienna `GCP_PROJECT`.
- Istniejący klucz SSH `~/.ssh/ssh_key` (klucz publiczny `~/.ssh/ssh_key.pub` jest dodawany do metadanych instancji przez `gcloud compute ssh`).
- Bash.

## Użycie

Poniższe przykłady zakładają, że jesteś w katalogu ze skryptem. Jak wywoływać go z dowolnego miejsca (alias, symlink, `PATH`) opisuje sekcja [Wywoływanie z dowolnego katalogu](#wywoływanie-z-dowolnego-katalogu).

```bash
./gcp-ssh.sh                 # krótka pomoc (bez parametrów)
./gcp-ssh.sh --help          # to samo co powyżej
./gcp-ssh.sh --list          # lista dostępnych VM-ek (nazwa, strefa, status)
./gcp-ssh.sh ssh-vm          # logowanie na konkretną VM (musi być uruchomiona)
./gcp-ssh.sh ssh-vm --command "uptime"   # dodatkowe argumenty trafiają do gcloud compute ssh
./gcp-ssh.sh --command "uptime"          # wybór VM z listy + wykonanie komendy
./gcp-ssh.sh ssh-vm --start              # uruchomienie konkretnej VM
./gcp-ssh.sh --start                     # wybór VM z listy i uruchomienie jej
./gcp-ssh.sh ssh-vm -r                   # skrót dla --start
./gcp-ssh.sh --stop                      # wybór VM z listy i zatrzymanie jej
./gcp-ssh.sh ssh-vm --stop               # zatrzymanie konkretnej VM
./gcp-ssh.sh ssh-vm -s                   # skrót dla --stop
```

### Opcje

| Opcja           | Skrót | Opis                                       |
|-----------------|-------|--------------------------------------------|
| `--help`        | `-h`  | wyświetla krótką pomoc                     |
| `--list`        | `-l`  | listuje dostępne VM-ki i kończy działanie  |
| `--start`       | `-r`  | uruchamia wybraną VM                       |
| `--stop`        | `-s`  | zatrzymuje wybraną VM                      |

Uruchomienie skryptu bez żadnych parametrów wyświetla krótką pomoc z opisem działania i przykładami. Opcje `--start`, `--stop` i `--list` nie łączą się ze sobą.

Lista dostępnych VM-ek pobierana jest przez `gcloud compute instances list` (wraz ze statusem), a strefa (`--zone`) dobierana jest automatycznie na podstawie nazwy instancji.

### Uruchamianie VM

Flaga `--start` (`-r`) uruchamia wybraną VM przez `gcloud compute instances start` i czeka na stan `RUNNING` (domyślnie do 300 s). VM już uruchomiona kończy się komunikatem bez ponownego wywołania `start`. W trybie `--start` klucz SSH nie jest wymagany.

Logowanie SSH wymaga uruchomionej VM. Jeśli VM jest wyłączona, skrypt kończy się błędem z podpowiedzią `gcp-ssh.sh NAZWA --start` — nie uruchamia jej automatycznie. VM w stanie `SUSPENDED` wymaga ręcznego wznowienia (`gcloud compute instances resume`).

### Zatrzymywanie VM

Flaga `--stop` (`-s`) zamiast logowania zatrzymuje wybraną VM przez `gcloud compute instances stop` i czeka na stan `TERMINATED` (domyślnie do 300 s). VM już wyłączona kończy się komunikatem bez ponownego wywołania `stop`. W trybie `--stop` klucz SSH nie jest wymagany. Zatrzymaną VM uruchom ponownie przez `--start`.

## Wywoływanie z dowolnego katalogu

Skrypt leży w `Scripts/ssh-vm/`, więc `./gcp-ssh.sh` działa tylko po wejściu do tego katalogu. Żeby uruchamiać go jedną komendą z dowolnego miejsca, najpierw nadaj mu prawo wykonywania:

```bash
chmod +x "$HOME/Documents/Development/pm-ai-assistant/Scripts/ssh-vm/gcp-ssh.sh"
```

Następnie wybierz jedną z poniższych opcji.

### Opcja 1: alias w `~/.zshrc` (najprostsza)

```bash
echo "alias gcp-ssh='$HOME/Documents/Development/pm-ai-assistant/Scripts/ssh-vm/gcp-ssh.sh'" >> ~/.zshrc
source ~/.zshrc
```

Od teraz w dowolnym katalogu:

```bash
gcp-ssh
gcp-ssh ssh-vm
gcp-ssh ssh-vm --start
gcp-ssh ssh-vm --stop
```

Alias działa tylko w interaktywnych powłokach — nie zadziała w skryptach ani gdy wywołujesz `gcp-ssh` z innego programu. W takich przypadkach użyj opcji 2 lub 3.

### Opcja 2: symlink w `~/bin` (zalecana)

```bash
mkdir -p "$HOME/bin"
ln -sf "$HOME/Documents/Development/pm-ai-assistant/Scripts/ssh-vm/gcp-ssh.sh" "$HOME/bin/gcp-ssh"
```

Dodaj `~/bin` do `PATH` (jednorazowo), jeśli jeszcze go tam nie ma:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Sprawdzenie:

```bash
command -v gcp-ssh    # powinno wskazać ~/bin/gcp-ssh
```

Symlink jest lepszy od kopiowania: po `git pull` od razu używasz nowej wersji skryptu, bo wskazuje na plik w repo.

### Opcja 3: `/usr/local/bin`

Jeśli wolisz katalog systemowy, pamiętaj, że na macOS jest on własnością `root`, więc `ln` wymaga `sudo`:

```bash
sudo ln -sf "$HOME/Documents/Development/pm-ai-assistant/Scripts/ssh-vm/gcp-ssh.sh" /usr/local/bin/gcp-ssh
```

`/usr/local/bin` jest zwykle już w `PATH`, więc nie trzeba nic dopisywać. Ten sam efekt daje symlink w `~/bin` bez `sudo` — opcja 2 jest bezpieczniejsza.

### Opcja 4: katalog skryptów w `PATH`

```bash
echo 'export PATH="$HOME/Documents/Development/pm-ai-assistant/Scripts/ssh-vm:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Wtedy wywołujesz skrypt razem z rozszerzeniem:

```bash
gcp-ssh.sh
gcp-ssh.sh ssh-vm --list
```

### Którą opcję wybrać

| Sytuacja | Opcja |
|---|---|
| Chcesz tylko pisać `gcp-ssh` w terminalu | 1 (alias) |
| Chcesz `gcp-ssh` także w skryptach i innych programach | 2 (symlink w `~/bin`) lub 3 |
| Nie chcesz zmieniać `PATH` | 3 (wymaga `sudo`) |

## Zmienne środowiskowe

| Zmienna            | Domyślnie                          | Opis                                  |
|--------------------|------------------------------------|---------------------------------------|
| `GCP_PROJECT`      | aktywny projekt z konfiguracji gcloud | projekt, w którym szukane są VM-ki |
| `GCP_SSH_KEY`      | `~/.ssh/ssh_key`                   | ścieżka do klucza prywatnego          |
| `GCP_START_TIMEOUT`| `300`                              | ile sekund czekać na uruchomienie VM (`--start`) |
| `GCP_STOP_TIMEOUT` | `300`                              | ile sekund czekać na zatrzymanie VM      |

Przykład:

```bash
GCP_PROJECT=inny-projekt gcp-ssh
```

## Rozwiązywanie problemów

- **`Permission denied (publickey)`** – upewnij się, że klucz publiczny jest w metadanych instancji:
  `gcloud compute instances add-metadata NAZWA --metadata-from-file ssh-keys=~/.ssh/ssh_key.pub --zone=STREFA`
  lub że instancja ma włączony OS Login.
- **OS Login** – jeśli instancja ma włączony OS Login, `--ssh-key-file` jest ignorowany. Wtedy dodaj klucz przez:
  `gcloud compute os-login ssh-keys add --key-file=~/.ssh/ssh_key.pub`
- **`bash: bad interpreter`** – sprawdź, czy plik ma poprawny shebang i jest zapisany bez znaków CRLF.
- **Brak VM-ek na liście** – sprawdź projekt (`gcloud config get-value project`) i uprawnienia konta.
