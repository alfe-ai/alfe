# Alfe AI  

## [Alfe AI](https://alfe.sh) Version 1: Sterling  
<!-- #### beta-0.43.0 -->

### FOSS AI Software Development Platform

![image](https://github.com/user-attachments/assets/62754c8a-d4a4-441f-9050-aeed4157926a)

#### System Requirements:
Linux, Debian, Ubuntu, and similar.

Windows Support is untested, official Windows support is planned.

Scripts to assist with setup of a Debian VM with QEMU are here: https://github.com/alfe-ai/alfe-dev_vms

---

1. Configure SSH key for GitHub. This script may be used: https://github.com/alfe-ai/alfe-dev_vms/blob/main/generate_github_ssh_key.sh
```
user@t03012025:~/git$ ./generate_github_ssh_key.sh 
Generating public/private rsa key pair.
Enter file in which to save the key (/home/user/.ssh/id_rsa): /home/user/.ssh/id_rsa_test2
Enter passphrase (empty for no passphrase): 
Enter same passphrase again: 
Your identification has been saved in /home/user/.ssh/id_rsa_test2
Your public key has been saved in /home/user/.ssh/id_rsa_test2.pub
The key fingerprint is:
SHA256:6Xvf751uKnYhF4JNPzgwcns/l7svVDWMWlkFKqaY1r4 t03012025@alfe.sh
The key's randomart image is:
+---[RSA 4096]----+
|              *oo|
|       . + . = o.|
|        o X *   o|
|       + * O +  .|
|      + S . + o..|
|     . o   . =.o |
|        o   o.+ .|
|         o.o o.oo|
|        E...+.=BB|
+----[SHA256]-----+
user@t03012025:~/git$ cat /home/user/.ssh/id_rsa_test2.pub
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQD3iRx+BSrGFVvO7oYjElBvybBg2bRyCZqPkES4CVAyqwvSqJIMtYE/xvWAcYPTJMXTt660bkr/7hF+N8QolxIw24NBEaF1mem8IffVibgQwiOdU3Y4p8rUDgIWWv1r6Kmx2mHhUt65Q+ePIILebS4iwK2Nor5gBF1x7oLUkwVy8rbXG1H/ov1cNeMqnOT1mAQtLUCZyGfICiR0wxcH1cuVCDnhhrRRCcESoF5ulOAiHtk3fZS69g+Mi3PKsDfV7Zi5vGk+du3O6mc+s9QgBpxk8Zbo/1anXay2N0qfZwgDZAqoydfXkZswOUS3J0hA1HI9b8kyQbJoIcr7w8AkDsV/Xk4Xo1GiLRG4Q4BM1IqbC3P/E4nJtnkKabcTjhN18qKcBwZUMms9RWSz4L4tZ0LOriDZCc1U4se+zMc4tTvmXa8mYQPeNR4uMwRgGjVCMJ88bBg4KjGyzVhNnU7cbSJMcBRngoicWDNN/X0DxybEqK2yq0qXe2so1XmTq/TyFigXWFUMacyUphnsYNWKx0s3KzcwyPIVjC3E1IxyS0fEjoxKN0iA9vopf+Bn7dJpGUH0DbftBPCwesLkuMhkIB9Tzluz06cwidSU/GXqoiMC/NEd4+GkjywLYvpov5BaxmGzid4+9ojHTbn0p+XIgzEPHD/qOxbpQrmdeWaWcxwuiQ== t03012025@alfe.sh
user@t03012025:~/git$ 
```

1.1. Copy the entire contents of your '.pub' file (Beginning with 'ssh-rsa') to a new SSH key within GitHub:  
https://github.com/settings/ssh/new  
https://github.com/settings/keys  

2. Ensure you have `nodejs` and `npm` installed on your system. On Debian, you can install them with:
```
sudo apt-get update
sudo apt-get install nodejs npm
```

3. Run `npm install` from the project root dir, you should see something similar to:
```
user@t03012025(f73c49f, 0 changes):~/.alfe/git/alfe-ai-org/alfe-dev$ npm install

up to date, audited 410 packages in 2s

56 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

4. Copy `sample.env` to `.env`, and update it with your API keys.

5. Run `./run_dev.sh` to run as the Development Environment.

6. Access the server at http://localhost:3001

7. Add a git repository to work on with http://localhost:3001/repositories/add , paste in the SSH url for the git repository to work on.

<!-- 8. In new chats, you can copy Agent Instructions from here: https://github.com/alfe-ai/alfe-agent_instructions (This will soon be integrated with the app)--><!--, I implemented this in an older branch, multiple agent support.)-->

### Related Repositories:  
Alfe AI / Agent Instructions: https://github.com/alfe-ai/alfe-agent_instructions

---

See the [LICENSE](https://github.com/alfe-ai/alfe/blob/main/LICENSE) file.

**Copyright (c) 2022-2025 [Nicholas Lochner](https://lochner.tech)**  
https://github.com/lochner-technology
