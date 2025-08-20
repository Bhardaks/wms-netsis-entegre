#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DatabaseBackup = require('./backend/db/backup');

console.log('🚀 WMS Netsis Entegre Safe Deployment Script');
console.log('=============================================\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function runCommand(command, description) {
  try {
    console.log(`📝 ${description}...`);
    const output = execSync(command, { encoding: 'utf-8', cwd: __dirname });
    console.log(`✅ ${description} completed`);
    return output;
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    throw error;
  }
}

async function main() {
  try {
    // 1. Database Backup
    console.log('1️⃣ Database Backup');
    console.log('-------------------');
    
    const dbBackup = new DatabaseBackup();
    
    if (fs.existsSync('./backend/db/wms.db')) {
      console.log('📦 Creating database backup...');
      const backupPath = await dbBackup.autoBackup();
      console.log(`✅ Database backup created: ${backupPath}\n`);
    } else {
      console.log('ℹ️ No database file found, skipping backup\n');
    }

    // 2. Git Status Check
    console.log('2️⃣ Git Status Check');
    console.log('--------------------');
    
    const gitStatus = await runCommand('git status --porcelain', 'Checking git status');
    
    if (gitStatus.trim()) {
      console.log('📋 Changes detected:');
      console.log(gitStatus);
      
      const proceed = await askQuestion('\n🤔 Do you want to commit these changes? (y/N): ');
      
      if (proceed.toLowerCase() === 'y' || proceed.toLowerCase() === 'yes') {
        // Add files
        await runCommand('git add .', 'Adding files to git');
        
        // Get commit message
        const commitMessage = await askQuestion('💬 Enter commit message: ');
        const finalMessage = commitMessage || 'Update WMS Netsis system with data safety improvements';
        
        // Commit
        await runCommand(`git commit -m "${finalMessage}

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"`, 'Creating commit');
      }
    } else {
      console.log('✅ No uncommitted changes detected\n');
    }

    // 3. Push to GitHub (Optional)
    console.log('3️⃣ GitHub Push (Optional)');
    console.log('--------------------------');
    
    const pushConfirm = await askQuestion('🚀 Push changes to GitHub? (y/N): ');
    
    if (pushConfirm.toLowerCase() === 'y' || pushConfirm.toLowerCase() === 'yes') {
      try {
        // Check current branch
        const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
        console.log(`📍 Current branch: ${currentBranch}`);
        
        // Check if git remote exists
        const remotes = execSync('git remote -v', { encoding: 'utf-8' }).trim();
        if (!remotes) {
          console.log('⚠️ No git remote configured. Skipping push.');
        } else {
          // Push
          await runCommand(`git push origin ${currentBranch}`, `Pushing to GitHub (${currentBranch})`);
          console.log('\n🎉 Successfully pushed to GitHub!');
        }
      } catch (error) {
        console.log('⚠️ Git push failed or no remote configured:', error.message);
      }
    } else {
      console.log('⏸️ Skipped GitHub push');
    }

    // 4. Summary
    console.log('\n📊 Deployment Summary');
    console.log('======================');
    
    // Show backup status
    const backups = dbBackup.listBackups();
    console.log(`💾 Available backups: ${backups.length}`);
    
    if (backups.length > 0) {
      console.log('📝 Latest backup:', backups[0].filename);
      console.log('📅 Created:', backups[0].created.toLocaleString());
      console.log(`📏 Size: ${(backups[0].size / 1024).toFixed(1)} KB`);
    }

    // Show git status
    const finalStatus = await runCommand('git status --porcelain', 'Final git status check');
    if (!finalStatus.trim()) {
      console.log('✅ Repository is clean');
    }

    console.log('\n🔒 Data Safety Features Active:');
    console.log('- ✅ Automatic backups on server start');
    console.log('- ✅ Pre-migration backups');
    console.log('- ✅ Database files excluded from git');
    console.log('- ✅ 30-day backup retention');

    console.log('\n🚀 WMS Netsis Deployment completed successfully!');
    console.log('Your data is safe and system is updated.');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    console.log('\n🛠️ Recovery options:');
    console.log('1. Check the error message above');
    console.log('2. Database backups are available in backend/db/backups/');
    console.log('3. Run "node deploy-safe.js" again after fixing issues');
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⏹️ Deployment cancelled by user');
  rl.close();
  process.exit(0);
});

main();