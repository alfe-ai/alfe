// Handles UI logic: expand/collapse sections, tabs, directory tree toggling,
// attached-file highlighting, 'git update/pull' action upon chat submit, and chat form AJAX submission with spinner and timer.

document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] chat.js => DOMContentLoaded, merging all logic.");

    // ============ Git Status Modal ============
    const gitStatusButton = document.getElementById('gitStatusButton');
    const gitStatusModal = document.getElementById('gitStatusModal');
    const closeModal = document.querySelector('.close');

    if (gitStatusButton && gitStatusModal && closeModal) {
        console.log("[DEBUG] Found #gitStatusButton => hooking up modal...");
        gitStatusButton.onclick = () => {
            gitStatusModal.style.display = 'block';
        };
        closeModal.onclick = () => {
            gitStatusModal.style.display = 'none';
        };
        window.onclick = (e) => {
            if (e.target === gitStatusModal) {
                gitStatusModal.style.display = 'none';
            }
        };
    }

    // ============ Collapsible Sections ============
    function setupCollapsibleSections() {
        const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
        collapsibleHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const section = header.parentElement;
                section.classList.toggle('expanded');
                section.classList.toggle('collapsed');
                console.log("[DEBUG] toggled collapsible =>", section);
            });
        });
    }
    setupCollapsibleSections();

    // ============ Tabs (Chat History, etc.) ============
    const tabButtons = document.querySelectorAll('.tablink');
    const tabContents = document.querySelectorAll('.tab-content');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            button.classList.add('active');
            const target = button.getAttribute('data-tab');
            document.getElementById(target).classList.add('active');
            console.log("[DEBUG] switched tab =>", target);

            // If Git Log tab is clicked, load the git commit graph
            if (target === 'gitLogTab') {
                loadGitLogGraph();
            }
        });
    });

    // ============ Directory Tree Expand/Collapse ============
    // We'll handle multiple .directory-tree elements
    const directoryTrees = document.querySelectorAll('.directory-tree');

    // ============ Attached Files ============
    const attachedFilesList = document.getElementById('attachedFilesList');
    const attachedFilesInput = document.getElementById('attachedFilesInput');
    const attachedFilesInputSaveState = document.getElementById('attachedFilesInputSaveState');

    let attachedFiles = [];
    try {
        if (attachedFilesInput) {
            attachedFiles = JSON.parse(attachedFilesInput.value) || [];
        }
    } catch (e) {
        console.error("[DEBUG] Could not parse attachedFilesInput =>", e);
        attachedFiles = [];
    }

    function updateAttachedFilesInput() {
        if (attachedFilesInput) {
            attachedFilesInput.value = JSON.stringify(attachedFiles);
        }
        if (attachedFilesInputSaveState) {
            attachedFilesInputSaveState.value = JSON.stringify(attachedFiles);
        }
    }

    function addAttachedFile(attachString) {
        if (!attachedFiles.includes(attachString)) {
            attachedFiles.push(attachString);
            updateAttachedFilesInput();

            // Update UI list
            if (attachedFilesList) {
                const li = document.createElement('li');
                li.textContent = attachString;
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.textContent = 'Remove';
                removeBtn.classList.add('remove-file-button');
                removeBtn.dataset.file = attachString;
                li.appendChild(removeBtn);
                attachedFilesList.appendChild(li);
            }
            console.log("[DEBUG] added attachedFile =>", attachString);
        }
    }

    function removeAttachedFile(attachString) {
        const idx = attachedFiles.indexOf(attachString);
        if (idx > -1) {
            attachedFiles.splice(idx, 1);
            updateAttachedFilesInput();
            // Remove from UI
            if (attachedFilesList) {
                const removeButtons = attachedFilesList.querySelectorAll('.remove-file-button');
                removeButtons.forEach(btn => {
                    if (btn.dataset.file === attachString) {
                        btn.parentElement.remove();
                    }
                });
            }
            console.log("[DEBUG] removed attachedFile =>", attachString);
        }
    }

    // Directory click => if it's a file-item, attach/unattach
    directoryTrees.forEach(tree => {
        tree.addEventListener('click', evt => {
            if (evt.target.classList.contains('file-item')) {
                const filePath = evt.target.dataset.path;
                const repoName = tree.dataset.repo;
                console.log("[DEBUG] file-item clicked => repo:", repoName, " path:", filePath);
                const attachString = `${repoName}|${filePath}`;

                if (attachedFiles.includes(attachString)) {
                    removeAttachedFile(attachString);
                    evt.target.classList.remove('selected-file');
                } else {
                    addAttachedFile(attachString);
                    evt.target.classList.add('selected-file');
                }
            } else if (evt.target.classList.contains('tree-label')) {
                // toggling folder
                const folderLI = evt.target.closest('.folder');
                if (folderLI) {
                    folderLI.classList.toggle('collapsed');
                    folderLI.classList.toggle('expanded');
                }
            }
        });
    });

    // Remove button in attached files list
    if (attachedFilesList) {
        attachedFilesList.addEventListener('click', (evt) => {
            if (evt.target.classList.contains('remove-file-button')) {
                const attachString = evt.target.dataset.file;
                console.log("[DEBUG] remove-file-button =>", attachString);
                removeAttachedFile(attachString);

                // unselect in directory trees
                const splitted = attachString.split('|');
                if (splitted.length === 2) {
                    const rName = splitted[0];
                    const rPath = splitted[1];
                    const matchingTree = document.querySelector(`.directory-tree[data-repo="${rName}"]`);
                    if (matchingTree) {
                        const fileItems = matchingTree.querySelectorAll('.file-item');
                        fileItems.forEach(item => {
                            if (item.dataset.path === rPath) {
                                item.classList.remove('selected-file');
                            }
                        });
                    }
                } else {
                    // fallback for older format
                    // remove from main repo
                    const mainTree = document.querySelector(`.directory-tree[data-repo]`);
                    if (mainTree) {
                        const fileItems = mainTree.querySelectorAll('.file-item');
                        fileItems.forEach(item => {
                            if (item.dataset.path === attachString) {
                                item.classList.remove('selected-file');
                            }
                        });
                    }
                }
            }
        });
    }

    // Highlight attached files on load
    function highlightAttachedFiles() {
        attachedFiles.forEach(af => {
            const splitted = af.split('|');
            if (splitted.length === 2) {
                const [rName, rPath] = splitted;
                const matchingTree = document.querySelector(`.directory-tree[data-repo="${rName}"]`);
                if (matchingTree) {
                    const fileItem = matchingTree.querySelector(`.file-item[data-path="${rPath}"]`);
                    if (fileItem) {
                        fileItem.classList.add('selected-file');
                    }
                }
            } else {
                // older format => assume main repo
                const mainTree = document.querySelector(`.directory-tree[data-repo]`);
                if (mainTree) {
                    const fileItem = mainTree.querySelector(`.file-item[data-path="${af}"]`);
                    if (fileItem) {
                        fileItem.classList.add('selected-file');
                    }
                }
            }
        });
    }
    highlightAttachedFiles();

    // ============ "git update/pull" Button ============
    const updatePullButton = document.getElementById('gitUpdatePullButton');
    if (updatePullButton) {
        console.log("[DEBUG] Found #gitUpdatePullButton => attaching click listener...");

        updatePullButton.addEventListener('click', () => {
            console.log("[DEBUG] updatePullButton clicked => fetching /:repoName/git_update...");
            // parse repoName from path => e.g. "/WhimsicalPuppet/chat/19"
            const pathParts = window.location.pathname.split('/');
            const repoName = pathParts[1] || "WhimsicalPuppet";

            fetch(`/${repoName}/git_update`, { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    const gitRevisionInfo = document.getElementById('gitRevisionInfo');
                    if (data.error) {
                        console.error("[DEBUG] git pull error =>", data.error);
                        if (gitRevisionInfo) {
                            gitRevisionInfo.innerHTML = `<span style="color:red;">Error: ${data.error}</span>`;
                        }
                    } else {
                        console.log("[DEBUG] git pull success => commit:", data.currentCommit);
                        if (gitRevisionInfo) {
                            gitRevisionInfo.innerHTML = `
                                <p style="color:green;">
                                    Pull success! Current commit: 
                                    <strong>${data.currentCommit}</strong>
                                </p>
                                <pre>${data.pullOutput}</pre>
                            `;
                        }
                    }
                })
                .catch(err => {
                    console.error("[DEBUG] fetch error =>", err);
                });
        });
    } else {
        console.log("[DEBUG] No #gitUpdatePullButton found => skipping pull logic.");
    }

    // ============ Chat Form AJAX Submission with Spinner and Timer ============
    const chatForm = document.getElementById('chatForm');
    const outputFilesTab = document.getElementById('outputFilesTab');

    let submitBtn = null;
    let queueBtn = null;
    let loadingIndicator = null;
    let executionTimeText = null;
    let timerInterval = null;

    if (chatForm) {
        // Grab the submit & queue buttons
        submitBtn = chatForm.querySelector('button[type="submit"]');
        queueBtn = chatForm.querySelector('button[formaction*="queue"]');

        // Create spinner container
        loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'loadingIndicator';
        chatForm.appendChild(loadingIndicator);

        // Execution time display
        executionTimeText = document.createElement('p');
        executionTimeText.id = 'executionTimeText';
        chatForm.appendChild(executionTimeText);

        // Define status stages
        const statusStages = [
            { name: 'Git pull', status: 'pending', startTime: null, endTime: null, element: null },
            { name: 'Waiting for AI response', status: 'pending', startTime: null, endTime: null, element: null },
            { name: 'Parsing files from AI output', status: 'pending', startTime: null, endTime: null, element: null },
            { name: 'Applying changes to local files', status: 'pending', startTime: null, endTime: null, element: null },
            { name: 'Git commit', status: 'pending', startTime: null, endTime: null, element: null },
            { name: 'Git push', status: 'pending', startTime: null, endTime: null, element: null },
            { name: 'Finalizing', status: 'pending', startTime: null, endTime: null, element: null }
        ];

        function startStage(index) {
            const stage = statusStages[index];
            if (stage) {
                stage.startTime = performance.now();
                stage.status = 'in progress';
                if (stage.element) {
                    const statusSpan = stage.element.querySelector('.stage-status');
                    if (statusSpan) {
                        statusSpan.textContent = '(In progress...)';
                    }
                }
            }
        }

        function completeStage(index) {
            const stage = statusStages[index];
            if (stage) {
                stage.endTime = performance.now();
                stage.status = 'complete';
                const duration = ((stage.endTime - (stage.startTime || stage.endTime)) / 1000).toFixed(2);
                // Update the element
                if (stage.element) {
                    stage.element.classList.add('completed-stage');
                    const statusSpan = stage.element.querySelector('.stage-status');
                    if (statusSpan) {
                        statusSpan.textContent = `(Complete - ${duration}s)`;
                    }
                }
            }
        }

        // Intercept form submission
        chatForm.addEventListener('submit', function (evt) {
            evt.preventDefault();

            const formData = new FormData(chatForm);

            // Disable inputs
            const chatInput = document.getElementById('chatInput');
            if (submitBtn) submitBtn.disabled = true;
            if (queueBtn) queueBtn.disabled = true;
            if (chatInput) chatInput.disabled = true;

            // Initialize stages
            if (loadingIndicator) {
                loadingIndicator.innerHTML = ''; // clear previous content
                loadingIndicator.style.display = 'block';
                statusStages.forEach(stage => {
                    stage.status = 'pending';
                    stage.startTime = null;
                    stage.endTime = null;

                    const stageElement = document.createElement('div');
                    stageElement.className = 'status-stage';
                    stageElement.innerHTML = `<span class="stage-name">${stage.name}</span> <span class="stage-status">(Pending)</span>`;
                    loadingIndicator.appendChild(stageElement);
                    stage.element = stageElement;
                });
            }

            // Start timer
            const startTime = performance.now();
            if (executionTimeText) {
                executionTimeText.style.display = 'block';
                executionTimeText.textContent = `Total run time: 0.00s`;
                timerInterval = setInterval(() => {
                    const now = performance.now();
                    const elapsed = ((now - startTime) / 1000).toFixed(2);
                    executionTimeText.textContent = `Total run time: ${elapsed}s`;
                }, 100);
            }

            // Get the repoName from the URL
            const pathParts = window.location.pathname.split('/');
            const repoName = pathParts[1] || "WhimsicalPuppet";

            // Start first stage - Git pull
            startStage(0);

            // First, trigger git update/pull action
            fetch(`/${repoName}/git_update`, { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    // Git pull completed
                    completeStage(0);

                    const gitRevisionInfo = document.getElementById('gitRevisionInfo');
                    if (data.error) {
                        console.error("Git update/pull error:", data.error);
                        if (gitRevisionInfo) {
                            gitRevisionInfo.innerHTML = `<span style="color:red;">Error: ${data.error}</span>`;
                        }
                    } else {
                        console.log("Git update/pull successful. Current commit:", data.currentCommit);
                        if (gitRevisionInfo) {
                            gitRevisionInfo.innerHTML = `
                                <p style="color:green;">
                                    Pull success! Current commit: 
                                    <strong>${data.currentCommit}</strong>
                                </p>
                                <pre>${data.pullOutput}</pre>
                            `;
                        }
                    }

                    // Start next stage - Waiting for AI response
                    startStage(1);

                    // Now proceed to send the chat message
                    return fetch(chatForm.action, {
                        method: 'POST',
                        body: formData
                    });
                })
                .then(async (response) => {
                    // AI response received
                    completeStage(1);

                    // Start next stage - Parsing files from AI output
                    startStage(2);

                    const data = await response.json();

                    // Process the data, update UI accordingly
                    if (data && data.updatedChat) {
                        if (data.updatedChat.chatHistory) {
                            const chatHistoryTab = document.getElementById('chatHistoryTab');
                            if (chatHistoryTab) {
                                updateChatHistory(chatHistoryTab, data.updatedChat.chatHistory);
                            }
                        }
                        if (data.updatedChat.extractedFiles) {
                            updateOutputFiles(outputFilesTab, data.updatedChat.extractedFiles);
                            setupCollapsibleSections();
                        }
                        if (data.updatedChat.summaryHistory) {
                            const summaryTab = document.getElementById('summaryTab');
                            if (summaryTab) {
                                updateSummaries(summaryTab, data.updatedChat.summaryHistory);
                                setupCollapsibleMessages(summaryTab);
                            }
                        }
                    }

                    // Parsing files completed
                    completeStage(2);

                    // Assuming 'Applying changes to local files' is immediate
                    startStage(3);
                    completeStage(3);

                    // Git commit
                    startStage(4);
                    // Assuming commit happens on the server, so we need to assume it's done
                    completeStage(4);

                    // Git push
                    startStage(5);
                    // Assuming push happens on the server
                    completeStage(5);

                    // Finalizing
                    startStage(6);
                    completeStage(6);

                    // Stop timer
                    clearInterval(timerInterval);
                    const endTime = performance.now();
                    const execSeconds = ((endTime - startTime) / 1000).toFixed(2);
                    if (executionTimeText) {
                        executionTimeText.textContent = `Total run time: ${execSeconds}s`;
                    }

                    // Re-enable
                    if (submitBtn) submitBtn.disabled = false;
                    if (queueBtn) queueBtn.disabled = false;
                    if (chatInput) {
                        chatInput.disabled = false;
                        chatInput.value = ""; // clear input
                    }

                    // Revert favicon to default
                    const fav = document.getElementById("favicon");
                    if(fav) fav.href = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><polygon points='32,4 4,60 60,60' fill='black' /></svg>";

                    if (!response.ok) {
                        console.error("Server returned error =>", data);
                        alert(data.error || "Error occurred.");
                        return;
                    }
                })
                .catch(err => {
                    console.error("Fetch error =>", err);
                    alert("Failed to send message. Check console.");

                    // Stop timer
                    clearInterval(timerInterval);
                    const endTime = performance.now();
                    const execSeconds = ((endTime - startTime) / 1000).toFixed(2);
                    if (executionTimeText) {
                        executionTimeText.textContent = `Total run time: ${execSeconds}s`;
                    }

                    // Re-enable
                    if (submitBtn) submitBtn.disabled = false;
                    if (queueBtn) queueBtn.disabled = false;
                    if (chatInput) chatInput.disabled = false;

                    // Revert favicon to default on error
                    const fav = document.getElementById("favicon");
                    if(fav) fav.href = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><polygon points='32,4 4,60 60,60' fill='black' /></svg>";
                });
        });
    }

    // Re-render chat history (reverse array so newest appear first).
    function updateChatHistory(chatHistoryTab, chatHistory) {
        if (!chatHistoryTab) return;

        // Clear existing
        chatHistoryTab.innerHTML = "";

        // Reverse the array to show newest at the top
        const reversed = chatHistory.slice().reverse();

        reversed.forEach((chat, index) => {
            // Create collapsible message container
            const collapsibleMessage = document.createElement('div');
            collapsibleMessage.className = 'collapsible-message';
            // Expand the newest message (index === 0)
            if (index === 0) {
                collapsibleMessage.classList.add('expanded');
            } else {
                collapsibleMessage.classList.add('collapsed');
            }

            // Message header
            const messageHeader = document.createElement('div');
            messageHeader.className = 'message-header';

            const triangle = document.createElement('span');
            triangle.className = 'triangle';

            const senderSpan = document.createElement('span');
            senderSpan.className = 'sender';
            senderSpan.textContent = chat.role.charAt(0).toUpperCase() + chat.role.slice(1);

            if (chat.timestamp) {
                const timestampSpan = document.createElement('span');
                timestampSpan.className = 'exec-time';
                timestampSpan.textContent = ` (${new Date(chat.timestamp).toLocaleString()})`;
                senderSpan.appendChild(timestampSpan);
            }

            messageHeader.appendChild(triangle);
            messageHeader.appendChild(senderSpan);

            // Message content
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';

            const contentPre = document.createElement('pre');
            contentPre.textContent = chat.content;

            messageContent.appendChild(contentPre);

            collapsibleMessage.appendChild(messageHeader);
            collapsibleMessage.appendChild(messageContent);

            chatHistoryTab.appendChild(collapsibleMessage);
        });

        // Set up event listeners for collapsible messages
        setupCollapsibleMessages(chatHistoryTab);
    }

    // Re-render summaries
    function updateSummaries(summaryTab, summaryHistory) {
        if (!summaryTab) return;

        // Clear existing
        summaryTab.innerHTML = "";

        if (summaryHistory.length === 0) {
            summaryTab.innerHTML = "<p>No summaries available.</p>";
            return;
        }

        // Reverse the array to show newest at the top
        const reversedSummaries = summaryHistory.slice().reverse();

        reversedSummaries.forEach((sum, index) => {
            const collapsibleMessage = document.createElement('div');
            collapsibleMessage.className = 'collapsible-message';
            collapsibleMessage.classList.add('collapsed');

            const messageHeader = document.createElement('div');
            messageHeader.className = 'message-header';

            const triangle = document.createElement('span');
            triangle.className = 'triangle';

            const senderSpan = document.createElement('span');
            senderSpan.className = 'sender';
            senderSpan.textContent = 'Summary';

            if (sum.timestamp) {
                const timestampSpan = document.createElement('span');
                timestampSpan.className = 'exec-time';
                timestampSpan.textContent = ` (${new Date(sum.timestamp).toLocaleString()})`;
                senderSpan.appendChild(timestampSpan);
            }

            messageHeader.appendChild(triangle);
            messageHeader.appendChild(senderSpan);

            // Message content
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';

            const contentPre = document.createElement('pre');
            contentPre.textContent = sum.content;

            messageContent.appendChild(contentPre);

            collapsibleMessage.appendChild(messageHeader);
            collapsibleMessage.appendChild(messageContent);

            summaryTab.appendChild(collapsibleMessage);
        });
    }

    // Update output files
    function updateOutputFiles(outputFilesTab, extractedFiles) {
        if (!outputFilesTab) return;

        // Clear existing content
        outputFilesTab.innerHTML = "";

        if (extractedFiles.length === 0) {
            outputFilesTab.innerHTML = "<p>No output files available.</p>";
            return;
        }

        extractedFiles.forEach(function(file) {
            const collapsibleSection = document.createElement('div');
            collapsibleSection.className = 'collapsible-section collapsed';

            const header = document.createElement('div');
            header.className = 'collapsible-header';

            const triangle = document.createElement('span');
            triangle.className = 'triangle';

            const h3 = document.createElement('h3');
            h3.textContent = file.filename;

            header.appendChild(triangle);
            header.appendChild(h3);

            const content = document.createElement('div');
            content.className = 'collapsible-content';

            const revP = document.createElement('p');
            revP.innerHTML = `<strong>Revision:</strong> ${file.rev}`;

            const dateP = document.createElement('p');
            dateP.innerHTML = `<strong>Date:</strong> ${file.dateStr}`;

            const pre = document.createElement('pre');
            pre.textContent = file.content;

            content.appendChild(revP);
            content.appendChild(dateP);
            content.appendChild(pre);

            collapsibleSection.appendChild(header);
            collapsibleSection.appendChild(content);

            outputFilesTab.appendChild(collapsibleSection);
        });
    }

    // Event delegation for collapsible messages in specified container
    function setupCollapsibleMessages(container) {
        if (container) {
            container.addEventListener('click', (evt) => {
                const messageHeader = evt.target.closest('.message-header');
                if (messageHeader) {
                    const collapsibleMessage = messageHeader.parentElement;
                    collapsibleMessage.classList.toggle('collapsed');
                    collapsibleMessage.classList.toggle('expanded');
                }
            });
        }
    }

    // Setup collapsible messages for chat history tab
    const chatHistoryTab = document.getElementById('chatHistoryTab');
    if (chatHistoryTab) {
        setupCollapsibleMessages(chatHistoryTab);
    }

    // Setup collapsible messages for summary tab
    const summaryTab = document.getElementById('summaryTab');
    if (summaryTab) {
        setupCollapsibleMessages(summaryTab);
    }

    // ============ Token Count Display ============
    const chatInput = document.getElementById('chatInput');
    const tokenCountDisplay = document.getElementById('tokenCountDisplay');

    if (chatInput && tokenCountDisplay) {
        chatInput.addEventListener('input', () => {
            const text = chatInput.value;
            const tokenCount = estimateTokenCount(text);
            tokenCountDisplay.textContent = `Tokens: ${tokenCount}`;
        });
    }

    function estimateTokenCount(text) {
        // Simple estimate: split on spaces and punctuation
        const tokens = text.trim().split(/\s+/).filter(token => token.length > 0);
        return tokens.length;
    }

    // ============ Load Git Log Graph ============
    let gitLogLoaded = false;

    function loadGitLogGraph() {
        if (gitLogLoaded) return; // Only load once
        gitLogLoaded = true;

        // Parse repoName from path
        const pathParts = window.location.pathname.split('/');
        const repoName = pathParts[1] || "WhimsicalPuppet";

        fetch(`/${repoName}/git_log`)
            .then(response => response.json())
            .then(data => {
                console.log("[DEBUG] Fetched git commit graph:", data);
                renderGitLogGraph(data.commits);
            })
            .catch(err => {
                console.error("[ERROR] Failed to fetch git log:", err);
            });
    }

    function renderGitLogGraph(commits) {
        const container = d3.select("#gitLogContainer");

        // Create a simple vertical list of commits with indents based on parent relationships
        // For a more advanced visualization, you might integrate a library like vis.js or Graphviz

        const commitMap = {};
        commits.forEach(commit => {
            commitMap[commit.hash] = commit;
        });

        // Build tree structure (assuming single parent for simplicity)
        commits.forEach(commit => {
            const parentHash = commit.parents[0];
            if (parentHash) {
                const parent = commitMap[parentHash];
                if (parent) {
                    parent.children = parent.children || [];
                    parent.children.push(commit);
                }
            }
        });

        // Extract root commits (no parents)
        const roots = commits.filter(commit => commit.parents.length === 0 || !commitMap[commit.parents[0]]);

        // Recursive function to display commits
        function displayCommit(commit, indent) {
            container.append('div')
                .style('margin-left', `${indent * 20}px`)
                .text(`${commit.hash} - ${commit.author} - ${commit.date} - ${commit.message}`);

            if (commit.children) {
                commit.children.forEach(child => {
                    displayCommit(child, indent + 1);
                });
            }
        }

        roots.forEach(root => {
            displayCommit(root, 0);
        });
    }

    // ============ Switch Branch Modal ============
    const switchBranchButton = document.getElementById('switchBranchButton');
    const switchBranchModal = document.getElementById('switchBranchModal');
    const closeSwitchBranch = document.querySelector('.close-switch-branch');
    const branchSelect = document.getElementById('branchSelect');
    const createNewBranchCheckbox = document.getElementById('createNewBranchCheckbox');
    const newBranchNameField = document.getElementById('newBranchName');
    const switchBranchSubmitButton = document.getElementById('switchBranchSubmitButton');
    const switchBranchMessage = document.getElementById('switchBranchMessage');

    if (switchBranchButton && switchBranchModal && closeSwitchBranch) {
        switchBranchButton.addEventListener('click', () => {
            switchBranchModal.style.display = 'block';

            // Clear previous data
            branchSelect.innerHTML = '';
            newBranchNameField.value = '';
            newBranchNameField.style.display = 'none';
            createNewBranchCheckbox.checked = false;
            switchBranchMessage.textContent = '';

            // Fetch branches
            const pathParts = window.location.pathname.split('/');
            const repoName = pathParts[1] || "WhimsicalPuppet";
            fetch(`/${repoName}/git_branches`)
                .then(res => res.json())
                .then(data => {
                    if (data.error) {
                        console.error("[DEBUG] Failed to fetch branches:", data.error);
                    } else {
                        data.branches.forEach(branch => {
                            const opt = document.createElement('option');
                            opt.value = branch;
                            opt.textContent = branch;
                            branchSelect.appendChild(opt);
                        });
                    }
                })
                .catch(e => console.error("[DEBUG] Branch fetch error:", e));
        });

        closeSwitchBranch.addEventListener('click', () => {
            switchBranchModal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === switchBranchModal) {
                switchBranchModal.style.display = 'none';
            }
        });

        createNewBranchCheckbox.addEventListener('change', () => {
            if (createNewBranchCheckbox.checked) {
                newBranchNameField.style.display = 'inline-block';
            } else {
                newBranchNameField.style.display = 'none';
            }
        });

        if (switchBranchSubmitButton) {
            switchBranchSubmitButton.addEventListener('click', () => {
                const pathParts = window.location.pathname.split('/');
                const repoName = pathParts[1] || "WhimsicalPuppet";

                const createNew = createNewBranchCheckbox.checked;
                const selectedBranch = branchSelect.value;
                const newBranchName = newBranchNameField.value.trim();

                const bodyData = {
                    createNew,
                    branchName: selectedBranch,
                    newBranchName: newBranchName
                };

                fetch(`/${repoName}/git_switch_branch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyData)
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data.error) {
                            switchBranchMessage.style.color = 'red';
                            switchBranchMessage.textContent = data.error;
                        } else {
                            switchBranchMessage.style.color = 'green';
                            switchBranchMessage.textContent = 'Branch switched successfully.';
                            setTimeout(() => {
                                window.location.reload();
                            }, 1000);
                        }
                    })
                    .catch(e => {
                        console.error("[DEBUG] Branch switch error:", e);
                        switchBranchMessage.style.color = 'red';
                        switchBranchMessage.textContent = 'Error switching branch.';
                    });
            });
        }
    }
});
