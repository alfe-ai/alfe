document.addEventListener("DOMContentLoaded", () => {
    console.log("[DEBUG] chat.js loaded... Branch switch feature active.");

    const switchBranchBtn = document.getElementById("switchBranchBtn");
    const switchBranchModal = document.getElementById("switchBranchModal");
    const branchSelectElement = document.getElementById("branchSelect");
    const createNewBranchCheckbox = document.getElementById("createNewBranchCheckbox");
    const newBranchNameField = document.getElementById("newBranchNameField");
    const confirmSwitchBranchBtn = document.getElementById("confirmSwitchBranchBtn");
    const repoNameElement = document.getElementById("repoNameForBranches");

    if (!switchBranchBtn || !switchBranchModal) {
        console.warn("[DEBUG] Switch Branch elements not found; skipping branch logic.");
        return;
    }

    // Open the modal
    switchBranchBtn.addEventListener("click", () => {
        if (!repoNameElement) {
            console.error("[DEBUG] Could not find repoNameForBranches element.");
            return;
        }
        const repoName = repoNameElement.value;
        switchBranchModal.style.display = "block";
        newBranchNameField.style.display = "none";

        // Fetch branch list
        fetch(`/${encodeURIComponent(repoName)}/git_branches`)
            .then(response => response.json())
            .then(data => {
                console.log("[DEBUG] Retrieved branch list:", data);
                // Populate select element
                branchSelectElement.innerHTML = "";
                data.forEach(branch => {
                    const option = document.createElement("option");
                    option.value = branch;
                    option.textContent = branch;
                    branchSelectElement.appendChild(option);
                });
            })
            .catch(err => {
                console.error("[DEBUG] Error fetching branches:", err);
            });
    });

    // Close modal if user clicks outside of it
    window.addEventListener("click", event => {
        if (event.target === switchBranchModal) {
            switchBranchModal.style.display = "none";
        }
    });

    // Toggle create new branch field
    createNewBranchCheckbox.addEventListener("change", () => {
        newBranchNameField.style.display = createNewBranchCheckbox.checked ? "block" : "none";
    });

    // Confirm branch switch
    confirmSwitchBranchBtn.addEventListener("click", () => {
        if (!repoNameElement) {
            console.error("[DEBUG] Could not find repoNameForBranches element for switching branch.");
            return;
        }
        const repoName = repoNameElement.value;
        const isNewBranch = createNewBranchCheckbox.checked;
        const selectedBranch = branchSelectElement.value;
        const newBranchName = document.getElementById("newBranchName").value.trim();

        let branchToSwitch = selectedBranch;
        if (isNewBranch) {
            if (!newBranchName) {
                alert("Please enter a new branch name.");
                return;
            }
            branchToSwitch = newBranchName;
        }

        console.log("[DEBUG] Attempting branch switch...", { isNewBranch, branchToSwitch });

        fetch(`/${encodeURIComponent(repoName)}/git_switch_branch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ branch: branchToSwitch, createNew: isNewBranch })
        })
            .then(response => response.json())
            .then(result => {
                console.log("[DEBUG] Switch branch result:", result);
                if (result.success) {
                    alert(`Switched to branch: ${branchToSwitch}`);
                    window.location.reload();
                } else {
                    alert(`Failed to switch branch. Error: ${result.error}`);
                }
            })
            .catch(err => {
                console.error("[DEBUG] Error switching branch:", err);
            });
    });
});