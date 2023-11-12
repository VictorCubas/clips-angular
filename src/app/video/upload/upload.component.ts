import { Component, OnDestroy } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AngularFireStorage, AngularFireUploadTask } from '@angular/fire/compat/storage';
import { v4 as uuid } from 'uuid';
import { combineLatest, forkJoin, last, switchMap } from 'rxjs';
import firebase from 'firebase/compat/app';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { ClipService } from 'src/app/services/clip.service';
import { Router } from '@angular/router';
import { FfmpegService } from 'src/app/services/ffmpeg.service';


@Component({
  selector: 'app-upload',
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent implements OnDestroy{
  isDragover: Boolean = false;
  file: File | null =  null;
  nextStep: boolean = false;
  showAlert = false;
  alertColor = 'blue';
  alertMsg = 'Please wait! Your clip is being uploading';
  inSubmission = false;
  percentage = 0;
  showPercentage = false;
  user: firebase.User | null = null;
  task?: AngularFireUploadTask;
  screenshots: string[] = [];
  selectedScreenshot = '';
  screenshotTask?: AngularFireUploadTask;

  title = new FormControl('', [
      Validators.required,
      Validators.minLength(3)
  ]) 

  uploadForm = new FormGroup({
    title: this.title
  })

  constructor(
    private storage: AngularFireStorage,
    private auth: AngularFireAuth,
    private clipServices: ClipService,
    private router: Router,
    public ffmpegService: FfmpegService
  ){
    auth.user.subscribe(user => {
      this.user = user
    });

    this.ffmpegService.init();
  }

  //este metodo lo usamos para agregar estilo
  //al hacer drop sobre el area dropeable
  async storeFile($event: Event){
    if( this.ffmpegService.isRunning){
      return;
    }

    this.isDragover = false;

    //($event as DragEvent).dataTransfer --> es exclusivo para eventos drag and drop
    this.file = ($event as DragEvent).dataTransfer ? 
    ($event as DragEvent).dataTransfer?.files.item(0) ?? null :
    ($event.target as HTMLInputElement).files?.item(0) ?? null;

    console.log(this.file);
    //validamos el archivo
    if(!this.file || this.file.type !== 'video/mp4'){
      return 
    }

    this.screenshots = await this.ffmpegService.getScreenshots(this.file);

    this.selectedScreenshot = this.screenshots[0];

    //quita la extension de archivo y solo deja el nombre
    this.title.setValue(this.file.name.replace(/\.[^/.]+$/, ''));
    //confirmamos que se levanto un mp4
    this.nextStep = true;

  }

  async uploadFile(){
    this.uploadForm.disable();
    this.showAlert = true;
    this.alertColor = 'blue';
    this.alertMsg = 'Please wait! Your clip is being uploading';
    this.inSubmission = true;
    this.showPercentage = true;

    const clipFileName = uuid();
    const clipPath = `clips/${clipFileName}.mp4`;

    const screenshotBlob = await this.ffmpegService.blobFromURL(
      this.selectedScreenshot
    );

    const screenshotPath = `screenshots/${clipFileName}.png`;
  
    this.task = this.storage.upload(clipPath, this.file); 
    const clipRef = this.storage.ref(clipPath);

    this.screenshotTask = this.storage.upload(screenshotPath, screenshotBlob);

    const screenshotRef = this.storage.ref(screenshotPath);

    combineLatest([
      this.task.percentageChanges(),
      this.screenshotTask.percentageChanges()
    ]).subscribe((progress) => {
      const [clipProgress, screenshotProgress] = progress;

      if(!clipProgress || !screenshotProgress){
        return;
      }

      const total = clipProgress + screenshotProgress;

      this.percentage = total as number / 200;
    })

    forkJoin([
      this.task.snapshotChanges(),
      this.screenshotTask.snapshotChanges()
    ]).pipe(
      switchMap( () => forkJoin([
        clipRef.getDownloadURL(),
        screenshotRef.getDownloadURL()
      ]))
    ).subscribe({
      next: async (urls) => {
        const [clipURL, screenshotURL] = urls;

        const clip = {
          uid: this.user?.uid as string,
          displayName: this.user?.displayName as string,
          title: this.title.value as string,
          fileName: `${clipFileName}.mp4`,
          url: clipURL,
          screenshotURL,
          screenshotFileName: `${clipFileName}.png`,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }

        const clipDocRef = await this.clipServices.createClip(clip);
        console.log(clip);

        this.alertColor = 'green';
        this.alertMsg = 'Success! Your clip is now ready to share to the world.';
        this.showPercentage = false;

        setTimeout(() => {
          this.router.navigate([
            'clip', clipDocRef.id
          ]);

        }, 1000);
      },
      error: (error) => {
        this.uploadForm.enable();
        this.alertColor = 'red';
        this.alertMsg = 'Upload failed! Please try again later';
        this.inSubmission = true;
        this.showPercentage = false;
        console.error(error);
      }
    })
  }

  ngOnDestroy(): void {
      //en caso de que cuando se este alzando un archivo alguien cambie de pagina
      //entonces de cancela la subida
      this.task?.cancel();
  }
}
